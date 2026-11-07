"""Independent F16 business judge; consumes actual raw, never runner exit alone."""
from pathlib import Path
import datetime, hashlib, json, re, sys

root = Path(sys.argv[1]).resolve()
raw = json.loads((root / 'raw.json').read_text())
oracle = json.loads((root / 'fixtures/oracle.json').read_text())
cleanup = json.loads((root / 'cleanup.json').read_text())
assert raw.get('notActualResult') is not True
assert raw['status'] == 'executed-unjudged', raw.get('failure')
modes = raw['modes']
assert [m['kind'] for m in modes] == ['normal', 'provider-unavailable']
normal, absent = modes
expected = {c['name']: c for c in oracle['cases']}
assert len(expected) == 3
assert [(c['file'], c['kind']) for c in normal['checks']] == [(c['name'], c['kind']) for c in oracle['cases']]
assert [(c['file'], c['kind']) for c in absent['checks']] == [('success.tex', 'provider-unavailable')]
checks = normal['checks'] + absent['checks']
rows = []

def record(cid, evidence):
    rows.append({'id': cid, 'passed': True, 'evidence': evidence})

for c in checks:
    original = expected[c['file']]
    proof = {'exactCompleteCMModel': True, 'characters': len(original['source']), 'sha256': hashlib.sha256(original['source'].encode()).hexdigest()}
    assert c['complete'] is True
    assert c['defaultSource'] == proof and c['returnedSource'] == proof
record('F16-A1', 'Exact original3 + providerFI1 identities; full source model SHA/length and roundtrip, not virtual DOM text')

success, missing, no_pages = normal['checks']
for c in checks:
    calls = [r for r in c['compileTrace'] if r['method'] == 'compileTex']
    assert len(calls) == 1
    if c is success:
        assert calls[0]['delivered'] is True
    else:
        assert not calls[0].get('delivered', False) and calls[0]['error']
receipt = success['realCompileReceipt']
assert receipt['pages'] == 1 and receipt['bytes'] > 0 and re.fullmatch(r'[a-f0-9]{64}', receipt['hash'])
assert 'TEXF16SUCCESS' in success['pdfText']
assert success['canvas']['width'] > 0 and success['canvas']['height'] > 0
assert success['canvas']['visible'] is True and success['canvas']['rendered'] == 'true'
record('F16-A2', 'One explicit actual compile; delivered PDF1page/bytes/hash; expected text and positive visible rendered canvas')

assert 'willyoumissingpackagef16' in missing['error'] and missing['noPDF'] is True and missing['recompileVisible'] is True
record('F16-A3', 'Actual distinct missing-package rejection; no PDF; recompile visible; source roundtrip')
assert 'No pages of output.' in no_pages['error'] and no_pages['error'] != missing['error']
assert no_pages['noPDF'] is True and no_pages['recompileVisible'] is True
record('F16-A4', 'Actual no-pages rejection, not fabricated exit0 or empty PDF')

fi = absent['checks'][0]
assert fi['providerUnavailableExplicit'] is True and fi['noPDF'] is True
assert re.search(r'ENOENT|引擎.*资源|离线.*编译器', fi['error'])
original_app = Path(normal['executable']).parents[2]
clone_app = Path(absent['executable']).parents[2]
assert original_app != clone_app
assert (original_app / 'Contents/Resources/native/tex').is_dir()
assert not (clone_app / 'Contents/Resources/native/tex').exists()
for relative in ['Contents/Resources/app.asar', 'Contents/MacOS/WillYou']:
    assert hashlib.sha256((original_app/relative).read_bytes()).digest() == hashlib.sha256((clone_app/relative).read_bytes()).digest()
assert raw['variantPreparation']
record('F16-A5', 'Separate resource-withheld private clone; original TeX present/clone absent; ASAR/exe same; actual explicit unavailable/noPDF/source roundtrip. Full clone inventory reviewed separately')

proof = json.loads((root/'source-proof.json').read_text())
for f in proof['files']:
    assert hashlib.sha256(Path(f['path']).read_bytes()).hexdigest() == f['sha256']
native = next(Path(f['path']) for f in proof['files'] if f['path'].endswith('/native/files/tex-compile.inc.mm'))
text = native.read_text()
assert '--only-cached' in text and '--untrusted' in text and 'sandbox-exec' in text
record('F16-A6', 'Pinned source fixed offline/untrusted/sandbox path plus real fixed3/1 receipts; not universal input shell/network proof')

for m in modes:
    assert len(m['before']) == 3 and m['before'] == m['after']
    assert sorted(m['projectEntries']) == sorted(expected)
    assert m['privateJobEntries'] == []
    assert all(c['after'] == m['before'] for c in m['checks'])
    assert m['tasksBefore'] == [] and m['tasksAfter'] == []
record('F16-A7', 'Both runs all3 source fingerprints unchanged; no project output and no private compiler job entries')

for m in modes:
    assert m['rendererErrors'] == []
    assert m['appExit']['code'] == 0 and m['appExit']['signal'] is None
    assert m['observedProcess']['signals'] == []
    assert len(m['restored']) == 3 and all(m['restored'].values())
    assert m['initialFocus'] and m['initialForeground'] and m['focusGuard']
    for t in m['trace']:
        if t.get('delivered'):
            assert t['input'] == t['inputAfter'] and t['before'] == t['after']
assert cleanup['allClear'] is True
record('F16-A8', 'Both normal exits/no signals/three observer restorations, source-preserving delegated IPC and independent all-clear. Exact initialFocus/once activation reviewed separately')

out = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'case': 'M12-T130/F16', 'actualRoot': str(root), 'rawSHA256': hashlib.sha256((root/'raw.json').read_bytes()).hexdigest(), 'cleanupSHA256': hashlib.sha256((root/'cleanup.json').read_bytes()).hexdigest(), 'passed': len(rows) == 8, 'checks': rows, 'formalIncrement': 0, 'fullT130Passed': False}
target = Path(__file__).parent/'judgement.json'
assert not target.exists(), 'Do not overwrite original judgement; new attempt directory required'
target.write_text(json.dumps(out, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'passed': out['passed'], 'checks': len(rows), 'formalIncrement': 0}))
