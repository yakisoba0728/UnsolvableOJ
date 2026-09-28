"""Smoke test all supported languages against the built Docker image."""

import json
import os
import subprocess
import sys
from uuid import uuid4

SOURCES = {
    'C': '#include <stdio.h>\nint main(void) { int a,b; scanf("%d %d", &a, &b); printf("%d\\n", a+b); }',
    'CPP': '#include <iostream>\nint main() { int a,b; std::cin >> a >> b; std::cout << a+b << "\\n"; }',
    'JAVA': 'import java.util.*; public class Main { public static void main(String[] args) { Scanner s = new Scanner(System.in); System.out.println(s.nextInt()+s.nextInt()); } }',
    'PYTHON': 'a,b=map(int,input().split()); print(a+b)',
    'JAVASCRIPT': 'const fs=require("fs"); const [a,b]=fs.readFileSync(0,"utf8").trim().split(/\\s+/).map(Number); console.log(a+b);',
    'TYPESCRIPT': 'import * as fs from "fs"; const [a,b]=fs.readFileSync(0,"utf8").trim().split(/\\s+/).map(Number); console.log(a+b);',
    'GO': 'package main\nimport "fmt"\nfunc main(){var a,b int;fmt.Scan(&a,&b);fmt.Println(a+b)}',
    'RUST': 'use std::io::{self,Read}; fn main(){let mut s=String::new();io::stdin().read_to_string(&mut s).unwrap();let v:Vec<i32>=s.split_whitespace().map(|x|x.parse().unwrap()).collect();println!("{}",v[0]+v[1]);}',
}


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
