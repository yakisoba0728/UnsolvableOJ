"""Smoke test all supported languages against the built Docker image."""

import json
import os
import subprocess
import sys
from uuid import uuid4
from pathlib import Path

SOURCES = json.loads(Path(__file__).with_name("smoke-sources.json").read_text())


def run(language, source, *, memory_mb=256, container_memory_mb=None, time_ms=5000):
    name = f'unsolvable-smoke-{uuid4()}'
    payload = {
        'language': language, 'sourceCode': source,
        'limits': {'timeMs': time_ms, 'memoryMb': memory_mb},
        'testCases': [{'input': '5 7\n', 'expectedOutput': '12\n'}],
    }
    container_memory_mb = container_memory_mb or max(128, memory_mb + 96)
    command = [
        'docker', 'run', '--rm', '-i', '--name', name,
        *(['--label', f'unsolvable.ci={os.environ["JUDGE_RUN_ID"]}']
          if os.environ.get('JUDGE_RUN_ID') else []),
        '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--pids-limit', '64',
        '--memory', f'{container_memory_mb}m', '--memory-swap', f'{container_memory_mb}m', '--cpus', '1',
        '--tmpfs', '/workspace:rw,exec,nosuid,size=256m,mode=1777',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m,mode=1777',
        '--env', 'HOME=/workspace', '--env', 'GOCACHE=/workspace/go-cache',
        '--env', 'GOPATH=/workspace/go', '--env', 'TMPDIR=/workspace/tmp',
        '--user', '65534:65534', '--workdir', '/workspace',
        os.environ.get('JUDGE_RUNTIME_IMAGE', 'unsolvable-judge-runtime:local'),
    ]
    try:
        completed = subprocess.run(command, input=json.dumps(payload), text=True, capture_output=True, timeout=90)
    finally:
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
    if completed.returncode == 137:
        # The worker also reports MLE when the kernel kills the supervisor.
        return {'status': 'MEMORY_LIMIT_EXCEEDED'}
    if completed.returncode:
        return {'status': 'DOCKER_ERROR', 'judgeMessage': completed.stderr[:300]}
    return json.loads(completed.stdout)


if __name__ == '__main__':
    failed = False
    for language, source in SOURCES.items():
        result = run(language, source)
        status = result['status']
        print(f'{language}: {status}', flush=True)
        if status != 'ACCEPTED':
            failed = True
            print(result.get('compileOutput') or result.get('judgeMessage') or '', flush=True)

    regressions = [
        ('problem memory limit', 'data = bytearray(64 * 1024 * 1024); print(12)',
         {'memory_mb': 16}, 'MEMORY_LIMIT_EXCEEDED'),
        # Make the container smaller than the declared problem limit to ensure
        # this exercises the kernel OOM path, not the RSS sampler.
        ('container OOM', 'from pathlib import Path; Path("/proc/self/oom_score_adj").write_text("1000"); data = bytearray(256 * 1024 * 1024); print(12)',
         {'memory_mb': 512, 'container_memory_mb': 128}, 'MEMORY_LIMIT_EXCEEDED'),
        ('explicit SIGKILL', 'import os, signal; os.kill(os.getpid(), signal.SIGKILL)',
         {}, 'RUNTIME_ERROR'),
    ]
    for label, source, limits, expected in regressions:
        result = run('PYTHON', source, **limits)
        print(f'{label}: {result["status"]}', flush=True)
        if result['status'] != expected:
            failed = True
            print(result, flush=True)
    sys.exit(1 if failed else 0)
