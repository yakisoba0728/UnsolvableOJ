from pathlib import Path
import datetime
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

BASE = Path('/workspace/scratch/3d1215725852/independent-qa')
SOURCE = Path('/workspace/scratch/3d1215725852/oj-frontend')
COMMIT = 'f872de5a344dfa1055fdd5864cf7ff92936fff61'
TREE = 'd2e61d7580793eef1e90ff532a69acd2b1e8bfe3'
HELPER = 'Front/tests/checkout-provenance.ts'
helper_bytes = (SOURCE / HELPER).read_bytes()
assert subprocess.check_output(['git', 'show', f'{COMMIT}:{HELPER}'], cwd=SOURCE) == helper_bytes
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip() == COMMIT
assert subprocess.check_output(['git', 'rev-parse', 'HEAD^{tree}'], cwd=SOURCE, text=True).strip() == TREE

records = []
temp = Path(tempfile.mkdtemp(prefix='provenance-owned-', dir=BASE))
try:
    checkout = temp / 'checkout'
    helper = checkout / HELPER
    helper.parent.mkdir(parents=True)
    helper.write_bytes(helper_bytes)
    (checkout / 'package.json').write_text('{"type":"module"}\n')
    tracked = checkout / 'tracked.txt'
    tracked.write_text('synthetic committed evidence\n')
    config = temp / 'owned-global-config'
    config.write_bytes(b'')
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env.update(GIT_CONFIG_GLOBAL=str(config), GIT_CONFIG_NOSYSTEM='1')

    def command(args, cwd=checkout, owner=False, check=True):
        current = dict(env)
        if owner:
            current.update(GIT_TEST_ASSUME_DIFFERENT_OWNER='1', GITHUB_SHA='f' * 40)
        result = subprocess.run(args, cwd=cwd, env=current, text=True, capture_output=True, timeout=20)
        if check:
            assert result.returncode == 0, {'args': args, 'returncode': result.returncode, 'stderr': result.stderr}
        return result

    command(['git', 'init', '-q'])
    command(['git', 'add', '.'])
    command(['git', '-c', 'user.name=Independent QA', '-c', 'user.email=review@example.invalid', 'commit', '-qm', 'Synthetic provenance fixture'])
    expected_sha = command(['git', 'rev-parse', 'HEAD']).stdout.strip()
    expected_tree = command(['git', 'rev-parse', 'HEAD^{tree}']).stdout.strip()
    local_config_before = (checkout / '.git/config').read_bytes()
    node_program = "import {pathToFileURL} from 'node:url'; const {checkoutProvenance}=await import(pathToFileURL(process.argv[1]).href); console.log(JSON.stringify(checkoutProvenance()));"

    def read_helper(path=helper, check=True):
        return command(['node', '--input-type=module', '-e', node_program, str(path)], cwd=temp, owner=True, check=check)

    plain = command(['git', 'rev-parse', 'HEAD'], owner=True, check=False)
    assert plain.returncode != 0 and 'dubious ownership' in plain.stderr
    records.append({'case': 'plain Git rejects forced ownership mismatch', 'result': 'PASS', 'exitCode': plain.returncode})
    wrong = command(['git', '-c', f'safe.directory={temp}', 'rev-parse', 'HEAD'], owner=True, check=False)
    assert wrong.returncode != 0 and 'dubious ownership' in wrong.stderr
    records.append({'case': 'another exact safe directory does not trust checkout', 'result': 'PASS', 'exitCode': wrong.returncode})

    clean = json.loads(read_helper().stdout)
    assert clean == {'sha': expected_sha, 'tree': expected_tree, 'trackedTreeClean': True}
    records.append({'case': 'actual helper returns real HEAD/tree/clean state despite caller cwd, owner mismatch and false GITHUB_SHA', 'result': 'PASS', 'provenance': clean})

    (checkout / 'untracked.txt').write_text('untracked fixture\n')
    assert json.loads(read_helper().stdout) == clean
    records.append({'case': 'untracked evidence does not falsely dirty tracked-tree status', 'result': 'PASS'})
    tracked.write_text('changed synthetic tracked evidence\n')
    dirty = json.loads(read_helper().stdout)
    assert dirty == {'sha': expected_sha, 'tree': expected_tree, 'trackedTreeClean': False}
    records.append({'case': 'tracked edits are truthfully reported without changing HEAD/tree', 'result': 'PASS', 'provenance': dirty})

    after = command(['git', 'rev-parse', 'HEAD'], owner=True, check=False)
    assert after.returncode != 0 and 'dubious ownership' in after.stderr
    assert config.read_bytes() == b''
    assert (checkout / '.git/config').read_bytes() == local_config_before
    records.append({'case': 'ordinary Git remains blocked afterward; global and repository Git config unchanged', 'result': 'PASS'})

    missing = temp / 'without-marker' / HELPER
    missing.parent.mkdir(parents=True)
    missing.write_bytes(helper_bytes)
    (missing.parents[2] / 'package.json').write_text('{"type":"module"}\n')
    failed = read_helper(missing, check=False)
    assert failed.returncode != 0 and not failed.stdout.strip()
    assert 'ENOENT' in failed.stderr
    records.append({'case': 'missing Git marker fails without environment provenance fallback', 'result': 'PASS', 'exitCode': failed.returncode})

    # The real author worktree has a .git file and exercises that supported path.
    actual = json.loads(read_helper(SOURCE / HELPER).stdout)
    assert actual == {'sha': COMMIT, 'tree': TREE, 'trackedTreeClean': True}
    records.append({'case': 'actual linked worktree .git file stays bound to reviewed commit/tree', 'result': 'PASS', 'provenance': actual})
    assert config.read_bytes() == b''

    result = {
        'reviewer': 'independent_qa',
        'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'sourceCommit': COMMIT,
        'sourceTree': TREE,
        'helperSha256': hashlib.sha256(helper_bytes).hexdigest(),
        'node': command(['node', '--version']).stdout.strip(),
        'git': command(['git', '--version']).stdout.strip(),
        'mode': 'Real Git and exact helper bytes with GIT_TEST_ASSUME_DIFFERENT_OWNER=1, empty reviewer-owned global config and no system config; no chmod/chown or browser execution.',
        'result': 'PASS',
        'checks': records,
        'cleanup': 'Owned synthetic fixture and config directory removed in finally.',
    }
finally:
    shutil.rmtree(temp)

out = BASE / 'provenance-f872de5-repro.json'
out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'path': str(out), 'sha256': hashlib.sha256(out.read_bytes()).hexdigest(), 'checks': len(records), 'result': result['result']}, indent=2))
