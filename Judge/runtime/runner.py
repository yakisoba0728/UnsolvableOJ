"""Runs one submission inside a disposable, networkless Docker container."""

import json
import os
import resource
import signal
import subprocess
import sys
import time
from pathlib import Path

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


def file_limit():
    resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_LIMIT, OUTPUT_LIMIT))


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


def execute(command, input_bytes, timeout, limit_files=True):
    out = WORK / 'stdout.txt'
    err = WORK / 'stderr.txt'
    input_file = WORK / 'stdin.txt'
    input_file.write_bytes(input_bytes or b'')
    with input_file.open('rb') as stdin, out.open('wb') as stdout, err.open('wb') as stderr:
        started = time.monotonic()
        process = subprocess.Popen(
            command, stdin=stdin, stdout=stdout, stderr=stderr, cwd=WORK,
            preexec_fn=file_limit if limit_files else None, start_new_session=True,
        )
        timed_out = False
        try:
            while True:
                finished, status, usage = os.wait4(process.pid, os.WNOHANG)
                if finished:
                    process.returncode = os.waitstatus_to_exitcode(status)
                    break
                if time.monotonic() - started >= timeout:
                    timed_out = True
                    os.killpg(process.pid, signal.SIGKILL)
                    _, status, usage = os.wait4(process.pid, 0)
                    process.returncode = os.waitstatus_to_exitcode(status)
                    break
                time.sleep(0.002)
        except BaseException:
            os.killpg(process.pid, signal.SIGKILL)
            os.wait4(process.pid, 0)
            raise
        duration_ms = round((time.monotonic() - started) * 1000)
    return process, timed_out, duration_ms, out.read_bytes(), err.read_bytes(), usage.ru_maxrss


def judge(payload):
    language = payload['language']
    cases = payload['testCases']
    if language not in LANGUAGES:
        return result('SYSTEM_ERROR', 0, len(cases), message='Unsupported language')

    filename, compile_command, run_command = LANGUAGES[language]
    (WORK / 'tmp').mkdir(exist_ok=True)
    (WORK / filename).write_text(payload['sourceCode'], encoding='utf-8')
    if compile_command:
        process, timed_out, _, output, errors, _ = execute(compile_command, None, 30, limit_files=False)
        if timed_out or process.returncode != 0:
            detail = (output + errors)[:65_536].decode('utf-8', errors='replace')
            return result('COMPILE_ERROR', 0, len(cases), compile_output=detail or 'Compilation timed out')

    passed = 0
    max_runtime = 0
    max_memory = 0
    limit = payload['limits']['timeMs'] / 1000
    for case in cases:
        process, timed_out, runtime, output, errors, memory = execute(
            run_command, case['input'].encode(), limit,
        )
        max_runtime = max(max_runtime, runtime)
        max_memory = max(max_memory, memory)
        if timed_out:
            return result('TIME_LIMIT_EXCEEDED', passed, len(cases), max_runtime, memory_kb=max_memory)
        if len(output) >= OUTPUT_LIMIT:
            return result('OUTPUT_LIMIT_EXCEEDED', passed, len(cases), max_runtime, memory_kb=max_memory)
        if process.returncode != 0:
            detail = errors[:1000].decode('utf-8', errors='replace')
            return result('RUNTIME_ERROR', passed, len(cases), max_runtime, message=detail, memory_kb=max_memory)
        if output.rstrip() != case['expectedOutput'].encode().rstrip():
            return result('WRONG_ANSWER', passed, len(cases), max_runtime, memory_kb=max_memory)
        passed += 1
    return result('ACCEPTED', passed, len(cases), max_runtime, memory_kb=max_memory)


if __name__ == '__main__':
    try:
        print(json.dumps(judge(json.load(sys.stdin))))
    except Exception as error:
        print(json.dumps(result('SYSTEM_ERROR', 0, 0, message=str(error)[:1000])))
