"""Launch a program from a fresh, small process and report its own wait4 usage.

The main supervisor holds all test data. Forking directly from it would charge
its inherited RSS to even a tiny submitted program's high-water memory usage.
"""

import json
import os
import resource
import sys


def main():
    report_fd = int(sys.argv[1])
    file_limit = int(sys.argv[2])
    command = sys.argv[3:]
    child = os.fork()
    if child == 0:
        os.close(report_fd)
        try:
            if file_limit:
                resource.setrlimit(resource.RLIMIT_FSIZE, (file_limit, file_limit))
            os.execvp(command[0], command)
        except OSError as error:
            print(str(error), file=sys.stderr, flush=True)
            os._exit(127)
    _, status, usage = os.wait4(child, 0)
    memory_kb = usage.ru_maxrss // 1024 if sys.platform == 'darwin' else usage.ru_maxrss
    os.write(report_fd, json.dumps({
        'returncode': os.waitstatus_to_exitcode(status),
        'memory_kb': memory_kb,
    }).encode())
    os.close(report_fd)


if __name__ == '__main__':
    main()
