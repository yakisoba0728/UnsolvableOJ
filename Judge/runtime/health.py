"""Fail closed if the Linux sandbox cannot enforce the required limits."""
import json
import urllib.request
from pathlib import Path

with urllib.request.urlopen('http://127.0.0.1:5050/version', timeout=2) as response:
    if json.load(response)['os'] != 'linux':
        raise SystemExit('Linux sandbox required')
with urllib.request.urlopen('http://127.0.0.1:5050/config', timeout=2) as response:
    config = json.load(response)['runnerConfig']
if (config['cgroupType'] not in (1, 2)
        or not {'cpu', 'memory', 'pids'} <= set(config['cgroupControllers'])
        or config['seccomp'] is not True or config['workDir'] != '/w'):
    raise SystemExit('seccomp and cpu/memory/pids cgroups required')
swap_limit = Path('/sys/fs/cgroup/memory.swap.max')
no_swap = (len(Path('/proc/swaps').read_text().splitlines()) <= 1
           or (swap_limit.exists() and swap_limit.read_text().strip() == '0'))
if not no_swap:
    raise SystemExit('Swap must be disabled for the sandbox')
