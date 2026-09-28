"""Smoke test all supported languages against the built Docker image."""

import json
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


def run(language, source):
    name = f'unsolvable-smoke-{uuid4()}'
    payload = {
        'language': language, 'sourceCode': source,
        'limits': {'timeMs': 5000, 'memoryMb': 256},
        'testCases': [{'input': '5 7\n', 'expectedOutput': '12\n'}],
    }
    command = [
        'docker', 'run', '--rm', '-i', '--name', name,
        '--network', 'none', '--read-only', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', '--pids-limit', '64',
        '--memory', '352m', '--memory-swap', '352m', '--cpus', '1',
        '--tmpfs', '/workspace:rw,exec,nosuid,size=256m,mode=1777',
        '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m,mode=1777',
        '--env', 'HOME=/workspace', '--env', 'GOCACHE=/workspace/go-cache',
        '--env', 'GOPATH=/workspace/go', '--env', 'TMPDIR=/workspace/tmp',
        '--user', '65534:65534', '--workdir', '/workspace',
        'unsolvable-judge-runtime:local',
    ]
    completed = subprocess.run(command, input=json.dumps(payload), text=True, capture_output=True, timeout=90)
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
    sys.exit(1 if failed else 0)
