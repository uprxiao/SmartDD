"""File-only gate; all OS-capable original phases call this before doing work."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).parent
APP=Path('/private/tmp/willyou-m12-s2-package-037/mac-arm64/WillYou.app')
def sha(p):
    h=hashlib.sha256()
    with Path(p).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def assert_bound(verify_inputs=True):
    b=json.loads((ROOT/'binding.json').read_text())
    assert b.get('ready') is True and b.get('app')==str(APP), 'PENDING actual App037/source044 binding; no OS/App operation allowed'
    receipt=json.loads((ROOT/'input-binding-receipt.json').read_text())
    assert receipt['bindingSha256']==sha(ROOT/'binding.json'), 'Binding did not finalize; no phase execution allowed'
    if not verify_inputs:return  # Resource-only final observation must remain usable after an input failure.
    assert sha(b['sourceManifest'])==b['sourceManifestSha256'], 'Current source044 manifest changed'
    assert sha(b['buildResult'])==b['buildResultSha256'], 'Current official App037 result changed'
    for row in json.loads((ROOT/'evidence/prepackaged-input-pins.json').read_text())['files']:
        p=APP/row['path']
        assert p.is_file() and not p.is_symlink(), 'Current critical file absent/link: '+str(p)
        assert sha(p)==row['sha256'] and p.stat().st_mode&511==row['mode'], 'Current App037 identity changed: '+str(p)
