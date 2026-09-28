import tempfile
import shutil
import unittest
import os
import sys
from pathlib import Path

import runner


class JudgeRunnerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        runner.WORK = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def payload(self, source, expected='3\n', time_ms=1000):
        return {
            'language': 'PYTHON',
            'sourceCode': source,
            'limits': {'timeMs': time_ms, 'memoryMb': 256},
            'testCases': [{'input': '1 2\n', 'expectedOutput': expected}],
        }

    def test_accepted(self):
        result = runner.judge(self.payload('a, b = map(int, input().split())\nprint(a+b)'))
        self.assertEqual(result['status'], 'ACCEPTED')
        self.assertEqual(result['passedTestCases'], 1)
        self.assertGreater(result['memoryKb'], 0)

    def test_wrong_answer(self):
        result = runner.judge(self.payload('print(4)'))
        self.assertEqual(result['status'], 'WRONG_ANSWER')

    def test_time_limit(self):
        result = runner.judge(self.payload('while True: pass', time_ms=100))
        self.assertEqual(result['status'], 'TIME_LIMIT_EXCEEDED')

    def test_output_limit(self):
        result = runner.judge(self.payload('print("x" * 1000001)'))
        self.assertEqual(result['status'], 'OUTPUT_LIMIT_EXCEEDED')

    def test_runtime_error(self):
        result = runner.judge(self.payload('raise RuntimeError("broken")'))
        self.assertEqual(result['status'], 'RUNTIME_ERROR')
        self.assertIn('broken', result['judgeMessage'])

    def test_memory_limit(self):
        payload = self.payload('data = bytearray(64 * 1024 * 1024)\nprint(3)')
        payload['limits']['memoryMb'] = 32
        result = runner.judge(payload)
        self.assertEqual(result['status'], 'MEMORY_LIMIT_EXCEEDED')
        self.assertGreater(result['memoryKb'], 32 * 1024)

    def test_sigkill_without_oom_is_runtime_error(self):
        result = runner.judge(self.payload('import os, signal\nos.kill(os.getpid(), signal.SIGKILL)'))
        self.assertEqual(result['status'], 'RUNTIME_ERROR')

    @unittest.skipUnless(sys.platform == 'linux', 'verifies Linux RSS accounting')
    def test_does_not_charge_supervisor_test_data_to_submission(self):
        large_payload = bytearray(40 * 1024 * 1024)
        execution = runner.execute(['/bin/true'], None, 1, memory_limit_kb=16 * 1024)
        self.assertEqual(len(large_payload), 40 * 1024 * 1024)
        self.assertFalse(execution.memory_exceeded)
        self.assertLess(execution.memory_kb, 16 * 1024)

    @unittest.skipUnless(sys.platform == 'linux', 'requires Linux /proc')
    def test_combined_child_memory_limit(self):
        payload = self.payload('''import os, time
children = []
for _ in range(2):
    pid = os.fork()
    if pid == 0:
        data = bytearray(40 * 1024 * 1024)
        time.sleep(0.3)
        os._exit(0)
    children.append(pid)
for pid in children:
    os.waitpid(pid, 0)
print(3)
''')
        payload['limits']['memoryMb'] = 64
        self.assertEqual(runner.judge(payload)['status'], 'MEMORY_LIMIT_EXCEEDED')

    @unittest.skipUnless(sys.platform == 'linux', 'requires Linux subreaper')
    def test_reaps_detached_children_on_exit_and_timeout(self):
        for time_out in (False, True):
            with self.subTest(time_out=time_out):
                source = '''import os, time
pid = os.fork()
if pid == 0:
    os.setsid()
    time.sleep(10)
else:
    print(pid, flush=True)
'''
                if time_out:
                    source += '    time.sleep(10)\n'
                execution = runner.execute(['python3', '-c', source], None, 0.2)
                child = int(execution.stdout.strip())
                self.assertEqual(execution.timed_out, time_out)
                with self.assertRaises(ProcessLookupError):
                    os.kill(child, 0)
                self.assertEqual(runner.descendants(), {})

    @unittest.skipUnless(shutil.which('gcc'), 'gcc is required')
    def test_compile_error(self):
        payload = self.payload('int main( {')
        payload['language'] = 'C'
        result = runner.judge(payload)
        self.assertEqual(result['status'], 'COMPILE_ERROR')
        self.assertTrue(result['compileOutput'])


if __name__ == '__main__':
    unittest.main()
