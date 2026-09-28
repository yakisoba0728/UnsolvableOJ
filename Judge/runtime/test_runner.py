import tempfile
import shutil
import unittest
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
        result = runner.judge(self.payload('print("before timeout", flush=True)\nwhile True: pass', time_ms=100))
        self.assertEqual(result['status'], 'TIME_LIMIT_EXCEEDED')
        self.assertEqual(result['debugOutputs'][0]['stdout'], 'before timeout\n')

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

    @unittest.skipUnless(shutil.which('gcc'), 'gcc is required')
    def test_compile_error(self):
        payload = self.payload('int main( {')
        payload['language'] = 'C'
        result = runner.judge(payload)
        self.assertEqual(result['status'], 'COMPILE_ERROR')
        self.assertTrue(result['compileOutput'])


if __name__ == '__main__':
    unittest.main()
