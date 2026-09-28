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

    @unittest.skipUnless(shutil.which('gcc'), 'gcc is required')
    def test_compile_error(self):
        payload = self.payload('int main( {')
        payload['language'] = 'C'
        result = runner.judge(payload)
        self.assertEqual(result['status'], 'COMPILE_ERROR')
        self.assertTrue(result['compileOutput'])


if __name__ == '__main__':
    unittest.main()
