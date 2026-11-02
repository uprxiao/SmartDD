from pathlib import Path
import subprocess
import hashlib
import json
import time

root = Path(__file__).resolve().parent
source = root / 'source'
evidence = root / 'line-ending-proof' / 'attempt001'
fixture = evidence / 'fixture'
scratch = evidence / 'scratch'
fixture.mkdir(parents=True)
scratch.mkdir()
relative = 'src/shared/application-module-catalog.json'
target = fixture / relative
target.parent.mkdir(parents=True)
canonical = (source / relative).read_bytes()
assert b'\r\n' not in canonical

def git(*argv):
    return subprocess.run(['git', *argv], cwd=fixture, capture_output=True, check=True)

git('init', '-q', '-b', 'main')
git('config', 'core.autocrlf', 'true')
git('config', 'commit.gpgsign', 'false')
(fixture / 'empty-hooks').mkdir()
git('config', 'core.hooksPath', str(fixture / 'empty-hooks'))
target.write_bytes(canonical)
git('add', '--', relative)
git('-c', 'user.name=WillYou Test', '-c', 'user.email=test@example.invalid',
    'commit', '-q', '-m', 'private canonical catalog fixture')
target.unlink()
git('checkout', '--', relative)
before = target.read_bytes()
assert b'\r\n' in before and before.replace(b'\r\n', b'\n') == canonical
old_eol = git('ls-files', '--eol', '--', relative).stdout.decode()
argv = ['node', 'scripts/applications/generate-module-metadata.mjs',
        '--output', str(target), '--scratch-root', str(scratch)]
started = time.monotonic()
old = subprocess.run(argv, cwd=source, capture_output=True)
(evidence / 'old-check.stdout.log').write_bytes(old.stdout)
(evidence / 'old-check.stderr.log').write_bytes(old.stderr)
assert old.returncode == 1 and b'metadata is stale' in old.stderr

(fixture / '.gitattributes').write_text(relative + ' text eol=lf\n')
git('add', '--', '.gitattributes')
target.unlink()
git('checkout', '--', relative)
after = target.read_bytes()
assert after == canonical
new_eol = git('ls-files', '--eol', '--', relative).stdout.decode()
new = subprocess.run(argv, cwd=source, capture_output=True)
(evidence / 'fixed-check.stdout.log').write_bytes(new.stdout)
(evidence / 'fixed-check.stderr.log').write_bytes(new.stderr)
assert new.returncode == 0
result = {
    'schema': 'willyou-canonical-catalog-windows-checkout-proof-v1',
    'scope': 'Private Git checkout with core.autocrlf=true on this Mac; not a Windows runner claim.',
    'repositoryGlobalGitConfigChanged': False,
    'sourceCatalogModified': False,
    'actualWindowsFailureJob': 125114325450,
    'old': {'checkout': old_eol.strip(), 'bytes': len(before),
            'sha256': hashlib.sha256(before).hexdigest(), 'exitCode': old.returncode},
    'fixed': {'checkout': new_eol.strip(), 'bytes': len(after),
              'sha256': hashlib.sha256(after).hexdigest(), 'exitCode': new.returncode},
    'semanticContentIdentical': True,
    'fix': 'Explicit LF checkout for the one generated catalog; preserve exact generator byte comparison.',
    'elapsedSeconds': round(time.monotonic() - started, 3),
    'status': 'passed-factor-isolation',
    'windowsActualVerification': 'pending new candidate Windows CI',
    'formalUniqueCasesAdded': 0,
}
(evidence / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))
