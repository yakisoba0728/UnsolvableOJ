import io
import json
import runpy
import unittest
from pathlib import Path
from unittest.mock import patch


class HealthTest(unittest.TestCase):
    def test_swap_policy_matches_startup(self):
        config = {'runnerConfig': {'cgroupType': 2, 'seccomp': True,
                  'cgroupControllers': ['cpu', 'memory', 'pids'], 'workDir': '/w'}}
        for active, limit, exists, healthy in [
            (False, 'max', True, True), (True, '0', True, True),
            (True, 'max', True, False), (True, 'max', False, False),
            (False, 'max', False, True),
        ]:
            with self.subTest(active=active, limit=limit, exists=exists):
                responses = [io.BytesIO(json.dumps(value).encode())
                             for value in [{'os': 'linux'}, config]]
                def text(path):
                    return ('header\nswap\n' if active else 'header\n') if str(path) == '/proc/swaps' else limit
                with patch('urllib.request.urlopen', side_effect=responses), \
                     patch.object(Path, 'exists', return_value=exists), \
                     patch.object(Path, 'read_text', text):
                    if healthy:
                        runpy.run_path(str(Path(__file__).with_name('health.py')))
                    else:
                        with self.assertRaisesRegex(SystemExit, 'Swap must be disabled'):
                            runpy.run_path(str(Path(__file__).with_name('health.py')))
