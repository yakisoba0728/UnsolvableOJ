"""Runs one submission inside a disposable, networkless Docker container."""

import ctypes
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from dataclasses import dataclass

WORK = Path(os.environ.get('JUDGE_WORK_DIR', '/workspace'))
OUTPUT_LIMIT = 1_000_000

LANGUAGES = {
    'C': ('main.c', ['gcc', 'main.c', '-O2', '-std=c17', '-o', 'main'], ['./main']),
    'CPP': ('main.cpp', ['g++', 'main.cpp', '-O2', '-std=c++20', '-o', 'main'], ['./main']),
    'JAVA': ('Main.java', ['javac', 'Main.java'], ['java', '-cp', '/workspace', 'Main']),
    'PYTHON': ('main.py', None, ['python3', 'main.py']),
    'JAVASCRIPT': ('main.js', None, ['node', 'main.js']),
    'TYPESCRIPT': ('main.ts', ['esbuild', 'main.ts', '--outfile=main.js', '--platform=node', '--format=cjs'], ['node', 'main.js']),
    'GO': ('main.go', ['go', 'build', '-o', 'main', 'main.go'], ['./main']),
    'RUST': ('main.rs', ['rustc', 'main.rs', '-O', '-o', 'main'], ['./main']),
}


def result(status, passed, total, runtime=0, compile_output=None, message=None, memory_kb=0):
    return {
        'status': status,
        'runtimeMs': runtime,
        'memoryKb': memory_kb,
        'passedTestCases': passed,
        'totalTestCases': total,
        'compileOutput': compile_output,
        'judgeMessage': message,
    }


@dataclass
class Execution:
    returncode: int
    timed_out: bool
    memory_exceeded: bool
    duration_ms: int
    stdout: bytes
    stderr: bytes
    memory_kb: int


def adopt_descendants():
    # Linux re-parents double-forked/setsid children to this supervisor, even
    # when it is not PID 1 (for example, when running the integration tests).
    if sys.platform == 'linux':
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
            raise OSError(ctypes.get_errno(), 'Cannot supervise child processes')


def descendants():
    if sys.platform != 'linux':
        return {}
    processes = {}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            # comm may contain spaces and parentheses. The fields after its
            # final ')' start with state, ppid; rss is field 24 (index 21).
            fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            processes[int(entry.name)] = (int(fields[1]), int(fields[21]))
        except (OSError, ValueError, IndexError):
            continue  # The process may have exited during the scan.
    pending = [os.getpid()]
    found = {}
    page_kb = os.sysconf('SC_PAGE_SIZE') // 1024
    while pending:
        parent = pending.pop()
        for pid, (ppid, rss) in processes.items():
            if ppid == parent and pid not in found:
                found[pid] = rss * page_kb
                pending.append(pid)
    return found


def oom_kills():
    # Docker exposes the container's cgroup v2 at this path. A killed child
    # does not necessarily kill PID 1, so Docker's exit code alone is not enough.
    try:
        events = dict(line.split() for line in Path('/sys/fs/cgroup/memory.events').read_text().splitlines())
        return int(events.get('oom_kill', 0))
    except (OSError, ValueError):
        return 0


def kill_group(pid):
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError:
        if sys.platform == 'darwin':
            # macOS can return EPERM while an already-killed group disappears.
            try:
                os.killpg(pid, 0)
            except ProcessLookupError:
                return
        raise


def clean_descendants(pid, existing):
    kill_group(pid)
    deadline = time.monotonic() + 2
    while remaining := descendants().keys() - existing:
        for child in remaining:
            try:
                os.kill(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
        for child in remaining:
            try:
                os.waitpid(child, os.WNOHANG)
            except ChildProcessError:
                pass  # It will be adopted after its own parent is reaped.
        if time.monotonic() >= deadline:
            raise RuntimeError('Could not clean up submission processes')
        time.sleep(0.002)


def execute(command, input_bytes, timeout, limit_files=True, memory_limit_kb=None):
    out = WORK / 'stdout.txt'
    err = WORK / 'stderr.txt'
    input_file = WORK / 'stdin.txt'
    input_file.write_bytes(input_bytes or b'')
    adopt_descendants()
    existing = descendants().keys()
    initial_oom_kills = oom_kills()
    report_read, report_write = os.pipe()
    with os.fdopen(report_read, 'rb') as report, input_file.open('rb') as stdin, out.open('wb') as stdout, err.open('wb') as stderr:
        started = time.monotonic()
        try:
            process = subprocess.Popen(
                [sys.executable, str(Path(__file__).with_name('execute.py').resolve()),
                 str(report_write), str(OUTPUT_LIMIT if limit_files else 0), *command],
                stdin=stdin, stdout=stdout, stderr=stderr, cwd=WORK,
                pass_fds=(report_write,), start_new_session=True,
            )
        finally:
            os.close(report_write)
        timed_out = False
        memory_exceeded = False
        max_memory = 0
        try:
            while True:
                # Exclude the small launcher itself, but include the submitted
                # program, all descendants, and any adopted orphan processes.
                memory = sum(rss for pid, rss in descendants().items()
                             if pid != process.pid and pid not in existing)
                max_memory = max(max_memory, memory)
                if memory_limit_kb is not None and memory > memory_limit_kb:
                    memory_exceeded = True
                    kill_group(process.pid)
                finished, status, usage = os.wait4(process.pid, os.WNOHANG)
                if finished:
                    process.returncode = os.waitstatus_to_exitcode(status)
                    break
                if memory_exceeded or time.monotonic() - started >= timeout:
                    timed_out = not memory_exceeded
                    kill_group(process.pid)
                    _, status, usage = os.wait4(process.pid, 0)
                    process.returncode = os.waitstatus_to_exitcode(status)
                    break
                time.sleep(0.002)
        except BaseException:
            if process.returncode is None:
                kill_group(process.pid)
                _, status, _ = os.wait4(process.pid, 0)
                process.returncode = os.waitstatus_to_exitcode(status)
            raise
        finally:
            clean_descendants(process.pid, existing)
        duration_ms = round((time.monotonic() - started) * 1000)
        metrics_bytes = report.read(4096)
        if metrics_bytes:
            metrics = json.loads(metrics_bytes)
            process.returncode = metrics['returncode']
            max_memory = max(max_memory, metrics['memory_kb'])
        elif process.returncode == 0:
            raise RuntimeError('Execution launcher did not report resource usage')
    memory_exceeded |= oom_kills() > initial_oom_kills
    if memory_limit_kb is not None:
        memory_exceeded |= max_memory > memory_limit_kb
    with out.open('rb') as stdout, err.open('rb') as stderr:
        return Execution(process.returncode, timed_out, memory_exceeded, duration_ms,
                         stdout.read(OUTPUT_LIMIT), stderr.read(OUTPUT_LIMIT), max_memory)


def judge(payload):
    debug_outputs = []
    verdict = judge_cases(payload, debug_outputs)
    verdict['debugOutputs'] = debug_outputs
    return verdict


def judge_cases(payload, debug_outputs):
    language = payload['language']
    cases = payload['testCases']
    if language not in LANGUAGES:
        return result('SYSTEM_ERROR', 0, len(cases), message='Unsupported language')

    filename, compile_command, run_command = LANGUAGES[language]
    (WORK / 'tmp').mkdir(exist_ok=True)
    (WORK / filename).write_text(payload['sourceCode'], encoding='utf-8')
    if compile_command:
        compilation = execute(compile_command, None, 30, limit_files=False)
        if compilation.timed_out or compilation.returncode != 0:
            detail = (compilation.stdout + compilation.stderr)[:65_536].decode('utf-8', errors='replace')
            if compilation.memory_exceeded:
                detail = 'Compiler exceeded container memory limit'
            return result('COMPILE_ERROR', 0, len(cases), compile_output=detail or 'Compilation timed out')

    passed = 0
    max_runtime = 0
    max_memory = 0
    limit = payload['limits']['timeMs'] / 1000
    # Public samples run first so private input left in files cannot appear
    # in a later sample's visible output. Keep original test case numbers.
    ordered_cases = sorted(enumerate(cases, start=1),
                           key=lambda item: item[1].get('isSample') is not True)
    for index, case in ordered_cases:
        execution = execute(
            run_command, case['input'].encode(), limit,
            memory_limit_kb=payload['limits']['memoryMb'] * 1024,
        )
        max_runtime = max(max_runtime, execution.duration_ms)
        max_memory = max(max_memory, execution.memory_kb)
        if case.get('isSample') is True and len(debug_outputs) < 5:
            debug_outputs.append({
                'testCase': index,
                'stdout': execution.stdout[:1000].decode('utf-8', errors='replace'),
                'stderr': execution.stderr[:1000].decode('utf-8', errors='replace'),
                'stdoutTruncated': len(execution.stdout) > 1000,
                'stderrTruncated': len(execution.stderr) > 1000,
            })
        if execution.memory_exceeded:
            return result('MEMORY_LIMIT_EXCEEDED', passed, len(cases), max_runtime, memory_kb=max_memory)
        if execution.timed_out:
            return result('TIME_LIMIT_EXCEEDED', passed, len(cases), max_runtime, memory_kb=max_memory)
        if len(execution.stdout) >= OUTPUT_LIMIT or len(execution.stderr) >= OUTPUT_LIMIT:
            return result('OUTPUT_LIMIT_EXCEEDED', passed, len(cases), max_runtime, memory_kb=max_memory)
        if execution.returncode != 0:
            detail = (execution.stderr[:1000].decode('utf-8', errors='replace')
                      if case.get('isSample') is True else 'Runtime error on a private test case')
            return result('RUNTIME_ERROR', passed, len(cases), max_runtime, message=detail, memory_kb=max_memory)
        if execution.stdout.rstrip() != case['expectedOutput'].encode().rstrip():
            return result('WRONG_ANSWER', passed, len(cases), max_runtime, memory_kb=max_memory)
        passed += 1
    return result('ACCEPTED', passed, len(cases), max_runtime, memory_kb=max_memory)


if __name__ == '__main__':
    try:
        print(json.dumps(judge(json.load(sys.stdin))))
    except Exception as error:
        print(json.dumps(result('SYSTEM_ERROR', 0, 0, message=str(error)[:1000])))
