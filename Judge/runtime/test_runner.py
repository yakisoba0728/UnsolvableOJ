import tempfile
import shutil
import unittest
from unittest.mock import patch
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
            'testCases': [{'input': '1 2\n', 'expectedOutput': expected, 'isSample': True}],
        }

    def test_accepted(self):
        result = runner.judge(self.payload('a, b = map(int, input().split())\nprint(a+b)'))
        self.assertEqual(result['status'], 'ACCEPTED')
        self.assertEqual(result['passedTestCases'], 1)
        self.assertGreater(result['memoryKb'], 0)

    def test_wrong_answer(self):
        result = runner.judge(self.payload('print(4)'))
        self.assertEqual(result['status'], 'WRONG_ANSWER')
        self.assertEqual(result['debugOutputs'][0]['stdout'], '4\n')

    def test_stdout_and_stderr_do_not_change_verdict(self):
        result = runner.judge(self.payload('import sys\nprint(3)\nprint("debug", file=sys.stderr)'))
        self.assertEqual(result['status'], 'ACCEPTED')
        self.assertEqual(result['debugOutputs'][0]['stdout'], '3\n')
        self.assertEqual(result['debugOutputs'][0]['stderr'], 'debug\n')

    def test_private_case_outputs_are_not_exposed(self):
        for sample_flag in (False, None):
            payload = self.payload('import sys\nprint(input())\nraise RuntimeError("private-input")')
            payload['testCases'][0]['isSample'] = sample_flag
            result = runner.judge(payload)
            self.assertEqual(result['status'], 'RUNTIME_ERROR')
            self.assertEqual(result['debugOutputs'], [])
            self.assertNotIn('private-input', result['judgeMessage'])

    def test_output_preview_is_bounded_without_changing_comparison(self):
        payload = self.payload('print("x" * 2000)', expected='x' * 2000 + '\n')
        payload['testCases'] *= 7
        result = runner.judge(payload)
        self.assertEqual(result['status'], 'ACCEPTED')
        self.assertEqual(result['passedTestCases'], 7)
        self.assertEqual(len(result['debugOutputs']), 5)
        self.assertEqual(len(result['debugOutputs'][0]['stdout']), 1000)
        self.assertTrue(result['debugOutputs'][0]['stdoutTruncated'])

    def test_stderr_output_limit(self):
        result = runner.judge(self.payload('import sys\nsys.stderr.write("x" * 1000001)'))
        self.assertEqual(result['status'], 'OUTPUT_LIMIT_EXCEEDED')

    def test_private_input_cannot_be_carried_into_sample_output(self):
        payload = self.payload(
            'from pathlib import Path\n'
            'value = input()\n'
            'saved = Path("saved.txt")\n'
            'print(saved.read_text() if saved.exists() else value)\n'
            'saved.write_text(value)')
        payload['testCases'] = [
            {'input': 'secret', 'expectedOutput': 'public', 'isSample': False},
            {'input': 'public', 'expectedOutput': 'public', 'isSample': True},
        ]
        result = runner.judge(payload)
        self.assertEqual(result['status'], 'ACCEPTED')
        self.assertEqual(result['debugOutputs'][0]['testCase'], 2)
        self.assertEqual(result['debugOutputs'][0]['stdout'], 'public\n')
        self.assertNotIn('secret', str(result['debugOutputs']))

    def test_timeout_keeps_flushed_output(self):
        # Allow interpreter startup under CI load; the short timeout is tested separately.
        result = runner.judge(self.payload('print("before timeout", flush=True)\nwhile True: pass', time_ms=1000))
        self.assertEqual(result['status'], 'TIME_LIMIT_EXCEEDED')
        self.assertEqual(result['debugOutputs'][0]['stdout'], 'before timeout\n')

    def test_time_limit(self):
        result = runner.judge(self.payload('while True: pass', time_ms=100))
        self.assertEqual(result['status'], 'TIME_LIMIT_EXCEEDED')

    def test_macos_cleanup_accepts_a_disappeared_process_group(self):
        with patch('runner.sys.platform', 'darwin'), patch(
            'runner.os.killpg', side_effect=[PermissionError(), ProcessLookupError()]
        ) as kill:
            runner.kill_group(12345)
            self.assertEqual(kill.call_args_list[-1].args, (12345, 0))

    def test_cleanup_does_not_hide_real_permission_errors(self):
        for platform, calls in [('darwin', 2), ('linux', 1)]:
            with self.subTest(platform=platform), patch('runner.sys.platform', platform), patch(
                'runner.os.killpg', side_effect=[PermissionError(), None]
            ) as kill:
                with self.assertRaises(PermissionError):
                    runner.kill_group(12345)
                self.assertEqual(kill.call_count, calls)

    def test_output_limit(self):
        result = runner.judge(self.payload('print("x" * 1000001)'))
        self.assertEqual(result['status'], 'OUTPUT_LIMIT_EXCEEDED')

    def test_runtime_error(self):
        result = runner.judge(self.payload('raise RuntimeError("broken")'))
        self.assertEqual(result['status'], 'RUNTIME_ERROR')
        self.assertIn('broken', result['judgeMessage'])

    def test_memory_limit(self):
        for is_sample in (True, False):
            with self.subTest(is_sample=is_sample):
                payload = self.payload(
                    'import sys\nprint("before memory", file=sys.stderr, flush=True)\n'
                    'data = bytearray(64 * 1024 * 1024)\nprint(3)')
                payload['limits']['memoryMb'] = 32
                payload['testCases'][0]['isSample'] = is_sample
                result = runner.judge(payload)
                self.assertEqual(result['status'], 'MEMORY_LIMIT_EXCEEDED')
                self.assertGreater(result['memoryKb'], 32 * 1024)
                if is_sample:
                    self.assertEqual(result['debugOutputs'][0]['stderr'], 'before memory\n')
                else:
                    self.assertEqual(result['debugOutputs'], [])

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
