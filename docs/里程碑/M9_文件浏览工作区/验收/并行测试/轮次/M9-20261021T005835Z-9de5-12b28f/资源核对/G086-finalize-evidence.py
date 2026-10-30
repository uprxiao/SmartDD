from pathlib import Path
import collections
import datetime
import hashlib
import json
import shutil

BASE = Path('/Users/liubu/Documents/ChatGPT/SmartDD/docs/里程碑/M9_文件浏览工作区')
RUN = 'M9-20261021T005835Z-9de5-12b28f'
PUB = BASE / '验收/证据/并行测试' / RUN
ROUND = BASE / '验收/并行测试/轮次' / RUN
ROOT = Path('/private/tmp/willyou-pdf-review-g087-root-9de5')
CASES = ['M9-T-T01', 'M9-T-T09', 'M9-T-T11']

def read(path):
    return json.loads(Path(path).read_text())

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def bundle(group, attempt, expected):
    path = PUB / group / ('attempt-' + attempt)
    manifest = read(path / 'manifest.json')
    assert sha(path / 'manifest.json') == expected
    for row in manifest['payload']:
        file = path / row.get('relativePath', row.get('path'))
        assert file.stat().st_size == row['bytes'] and sha(file) == row['sha256'], file
    for row in manifest.get('frozenInputs', []):
        file = Path(row['path'])
        assert file.stat().st_size == row['bytes'] and sha(file) == row['sha256'], file
    return path, manifest

path_a, man_a = bundle('M9-G086', '005', 'dfeb4ca1bcab85bf7a6d1ced80ba5dd1e0d33068b38289a783600740c0e349da')
path_p, man_p = bundle('M9-G086', '006', 'ee0a0b584b47ad7b359e2e0a85abeab1601cdabe8e9c286d9c4495cc0024c244')
a, p = read(path_a / 'actual/result.json'), read(path_p / 'actual/result.json')
for layer, data, folder in [('A', a, path_a), ('P', p, path_p)]:
    assert data['businessCompleted'] and data['sourceUnchanged'] and data['frozenInputsUnchanged']
    assert len(data['checks']) == 20 and all(c['passed'] for c in data['checks'])
    assert data['normalAppExit']['code'] == 0 and data['normalAppExit']['signal'] is None
    cleanup = read(folder / 'actual/cleanup.json')
    assert cleanup['normalExitSucceededWithin20s'] and cleanup['complete']
    observer = data['readerCleanup']
    assert observer['listenersRemoved'] == 6 and observer['globalRemoved'] and observer['productMethodsWrapped'] == 0
    for theme in ['light', 'dark']:
        checks = [c for c in data['checks'] if c['theme'] == theme]
        assert len(checks) == 10
        aa = [c['evidence'] for c in checks if c['label'].startswith('artifact')]
        rr = [c['evidence'] for c in checks if c['label'].startswith(('review one', 'review three'))]
        assert [v['pdfState']['total'] for v in aa] == [1, 3, 1]
        assert [v['pdfState']['total'] for v in rr] == [1, 3, 1]
        for v in aa:
            assert not v['review'] and v['textLayers'] > 0 and v['zoom']
            assert v['rails'] == (1 if v['pdfState']['total'] > 1 else 0)
            if v['pdfState']['total'] > 1:
                assert v['linkLayers'] > 0 and v['commentNodes'] > 0
            if layer == 'A':
                assert not v['pdfProps']['review'] and v['navigationView'] is None
            else:
                assert v['pdfProps']['kind'] == 'pdf'
        for v in rr:
            assert v['review'] and v['textLayers'] == v['linkLayers'] == v['commentNodes'] == v['rails'] == 0
            assert not v['zoom'] and len(v['canvas']) == 1
            assert (v['pager'] is not None) == (v['pdfState']['total'] > 1)
            old = next(z for z in aa if z['activeName'] == v['activeName'])
            if layer == 'A':
                assert v['pdfProps']['review'] and v['navigationView'] == 'review'
                assert all(v[k] == old[k] for k in ['tabId', 'bufferToken', 'ref', 'instance'])
            else:
                assert v['pdfProps']['kind'] == 'pdf-review'
                assert v['pdfProps']['path'] == old['pdfProps']['path'] and v['tabToken'] == old['tabToken']
        evidence = next(c['evidence'] for c in checks if c['label'] == 'review pager hover/focus')
        assert evidence['hidden']['pager']['opacity'] == 0
        assert evidence['hovered']['pager']['opacity'] >= .99 and evidence['focused']['pager']['focused']
        selection = next(c['evidence'] for c in checks if c['label'] == 'review canvas selection attempt/no layers')
        assert any(e['type'] == 'pointerdown' and e['trusted'] for e in selection['events'])
        assert any(e['type'] == 'pointerup' and e['trusted'] for e in selection['events'])
        for resize in [v for v in data['resizeEvidence'] if v['theme'] == theme]:
            for step in ['fitBefore', 'fitAfter', 'fitAfterReturn']:
                v = resize[step]
                canvas = v['canvas'][0]['rect']
                available = v['clientWidth'] - v['paddingLeft'] - v['paddingRight']
                assert abs(canvas['width'] - available) <= 1.5
                assert abs(canvas['width'] / canvas['height'] - 612 / 792) < .005
                assert v['scrollWidth'] <= v['clientWidth'] + 1.5
    proof = read(ROUND / ('资源核对/G086-' + ('A005' if layer == 'A' else 'P006') + '-root-release.json'))
    assert proof['resourceReleaseConfirmed'] and not proof['presentKnownPids']
assert all(a['fileRestored'].values())
assert not any(v.get('name', v.get('method')) in ['save', 'checkpoint'] for v in a['fileTrace'])

source_manifest = ROOT / 'r157-source-manifest.json'
source_sha = '6254e4ce044f51de78a1c6c3675a515b4e79c7f06e8f3552ebb813a5127c6a21'
assert sha(source_manifest) == source_sha
source = read(source_manifest)
for row in source['inputs']:
    file = Path(source['source']) / row['path']
    assert file.stat().st_size == row['bytes'] and sha(file) == row['sha256'], file
pm = Path('/private/tmp/willyou-pdf-review-g086-9de5/ready-pending-v1/P-built-v3-manifest.json')
p_sha = '85c7bc7dfc4567c125f1214ef87df9615146885469a7036b1b3d224dbeaa568f'
assert sha(pm) == p_sha
pd = read(pm)
for row in pd['files']:
    file = Path(pd['output']) / row['path']
    assert file.stat().st_size == row['bytes'] and sha(file) == row['sha256'], file
app = Path('/private/tmp/willyou-m9-9de5-r157-build/mac-arm64/WillYou.app')
asar_sha = '53e373afa67a494a81d452537be50d8bbee61d0f0b3872f3699b3161231826f6'
assert sha(app / 'Contents/Resources/app.asar') == asar_sha

rmap = read(PUB / 'M9-G089/attempt-001/reference-map.json')
ledger = read(BASE / '验收/用例覆盖索引.json')
by_id = {c['id']: c for c in ledger['cases']}
for row in rmap['cases']:
    assert not row['remainingR']
    for key in ['id', 'title', 'requirements', 'environments', 'steps', 'expected', 'source', 'basis']:
        assert by_id[row['case']][key] == row['contract'][key], (row['case'], key)
for row in rmap['sources']:
    file = row['actualFormattedFile']
    assert Path(file['path']).stat().st_size == file['bytes'] and sha(file['path']) == file['sha256']

now = datetime.datetime.now(datetime.timezone.utc).isoformat()
end_path = ROUND / '资源核对/G086-r157-final-baseline.json'
end = {'at': now, 'sourceInputsVerified': len(source['inputs']), 'sourceManifestSHA256': source_sha,
       'POutputFilesVerified': len(pd['files']), 'P3ManifestSHA256': p_sha, 'AppASARSHA256': asar_sha,
       'A20andP20OriginalMatrixRootVerified': True, 'RAllowedSourcesVerified': len(rmap['sources']),
       'originalContractsPreserved': True, 'AOriginalMethodsRestored': True, 'ASaveOrCheckpointCalls': 0,
       'PReadbackBoundary': 'P uses actual prototype kind/tab token; no physical FileRef/Buffer claims. A actual route/props/FileRef/Buffer independently verified.'}
write(end_path, end)
proof_path = BASE / '验收/证据/m9-acceptance-pdf-review-complete-r157-20261022-9de5.json'
assert not proof_path.exists(), 'Never overwrite a final completion proof'
layers = {
    'R': {'archive': str(PUB / 'M9-G089/attempt-001'), 'manifestSHA256': 'ef7bcbeb3fca2613cde62ea6c0549d2e6b098faf96007207bd227b18bf36d4a4',
          'casesRemainingR': 0, 'boundary': 'Allowed archived static sources, no dynamic Codex/V claim'},
    'I': {'archive': str(PUB / 'M9-G087/attempt-001'), 'manifestSHA256': 'da1a31698c56bcff9964c3badb021f7803b07d64e28adff37d46ee24a5b804f1',
          'checks': ['single-page-acceptance.test.tsx: actual FileBuffer/host artifact and review1→3→1; decoder/canvas explicitly isolated',
                     'single-page-acceptance.test.tsx: ResizeObserver current-width fit, saved artifact zoom unchanged',
                     'range-navigation-acceptance.test.ts: real related/open chain; PDF point/range review, same identity and dirty/late guards',
                     'range-editor-acceptance.test.tsx: actual EditorView readonly/history/selection'],
          'relatedUniqueFinalPassed': 191, 'prototypeModelPassed': 19, 'types': 'Node/Web passed', 'packagedNativeSmokePassed': 6,
          'outerSandboxFailureRetained': 'Initial11 native checks blocked by external nested sandbox; same affected2files21tests passed in system execution environment, no App policy or assertion changed'},
}
for layer, folder, manifest, data in [('A', path_a, man_a, a), ('P', path_p, man_p, p)]:
    layers[layer] = {'archive': str(folder), 'manifestSHA256': sha(folder / 'manifest.json'), 'passed': 20, 'planned': 20,
                     'themes': ['light', 'dark'], 'normalAppExit': data['normalAppExit'], 'originalNormalExitBudgetMs': 20000,
                     'payloadVerified': len(manifest['payload']), 'frozenInputsVerified': len(manifest['frozenInputs'])}
layers['A']['routes'] = 'Original filetree artifact and trusted local Markdown #L1/#L1-L2 review; same physical tab/ref/buffer verified'
layers['P'].update({'fullSharedFileWorkspace': True, 'P3ManifestSHA256': p_sha, 'boundary': 'Synthetic metadata only; actual prototype kind/path/tab tokens; no native IO or physical capability identity claim',
                    'buildRecovery': str(path_p / 'P-build-recovery')})
complete = {
    'at': now, 'caseIds': CASES, 'caseCompletion': {cid: '通过' for cid in CASES},
    'requirementBaseline': 'M9 R3.4/P1 R06.5/R06.16/R06.17; original case contracts unchanged',
    'branch': 'feature/0.0.1', 'head': '18efa6a6ae1722a0bcc8627ddd518f07d2f96625', 'sourceManifestSHA256': source_sha,
    'sourceRecovery': {'archive': 'release/m9-goal-9de5/r157-source.tar.gz', 'sha256': '0932f6b0ad1b05c5208288dc5ff6b4abed408ed639862a6bd0b007ee3ca0dcdd'},
    'app': {'path': str(app), 'asarSHA256': asar_sha, 'nativeSHA256': '57d2e5a5848d100d87df8248844b5f018ecc5f1f0ee5792103003de323d8cd0c',
            'normalBuildsForBaseline': 1, 'runtimeByteMatches': 340, 'packageByteMatches': 616},
    'layers': layers,
    'actualChecks': {layer: [{'label': c['label'], 'theme': c['theme'], 'passed': c['passed']} for c in data['checks']] for layer, data in [('P', p), ('A', a)]},
    'sourceProtection': 'All five source fixture bytes/hash/dev/inode/mtime/ctime/mode unchanged in each layer; A46delegated file RPCs with0save/0checkpoint,all7 restored; each6passive listeners/global removed,0renderer product methods wrapped',
    'resourceProofs': [str(ROUND / '资源核对/G086-A005-root-release.json'), str(ROUND / '资源核对/G086-P006-root-release.json'), str(end_path)],
    'retainedFailures': {'G086002': 'Driver repeated pin on already-pinned source; no business pass',
                         'G086003': 'Driver reused stale splitter point after layout; no product fit failure inferred',
                         'G086004': 'Auxiliary driver exact-return<=2px gate stopped on3px; not originalT11 condition; original fit oracle retained',
                         'G087': 'Original7business reds and viewer-choice1regression fixed; red/green evidence retained'},
    'geometryBoundary': 'Original fit1.5px/aspect delta<.005/no overflow unchanged. Actual A return clientWidth-3px both themes and P0px retained; no exact-return product claim.',
    'partialOtherCases': 'F03/F29 PDF same-buffer review substeps covered; MD/CSV extras not executed here, original title/artifact caller requirements still missing; no whole pass.',
    'originalLayersAndAllOtherChecksPreserved': True, 'scopeReduced': False, 'formalUniqueIncrement': 3, 'totalCurrent': 419, 'releasePerformed': False,
}
write(proof_path, complete)
print(json.dumps({'completeProof': str(proof_path), 'sha256': sha(proof_path), 'sourceInputs': len(source['inputs']),
                  'POutputs': len(pd['files']), 'P84PayloadVerified': True, 'wholeCasesVerified': CASES, 'authorityWritten': False}, ensure_ascii=False))
