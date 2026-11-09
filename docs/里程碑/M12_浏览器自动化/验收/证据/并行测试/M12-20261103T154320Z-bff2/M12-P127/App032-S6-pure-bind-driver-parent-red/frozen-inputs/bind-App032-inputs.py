#!/usr/bin/python3
"""Pure files: bind actual official App032 identity, never start tools or App."""
from pathlib import Path
import argparse,datetime,hashlib,json,os,plistlib,re,stat

ROOT=Path(__file__).parent
APP=Path('/private/tmp/willyou-m12-s2-package-032/mac-arm64/WillYou.app')
START=ROOT/'installed-startup-001'
def sha(p):
    h=hashlib.sha256()
    with Path(p).open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()
def save(p,j):p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
def row(p):return {'path':str(p),'sha256':sha(p),'mode':stat.S_IMODE(p.stat().st_mode)}
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--execute',action='store_true',required=True)
    for k in ['source-manifest','source-sha','build-result','build-sha']:ap.add_argument('--'+k,required=True)
    a=ap.parse_args()
    assert os.environ.get('WILLYOU_APP032_INPUT_BINDING_CONFIRMED')=='1', 'Root must review exact official build before binding'
    from binding_static import check_prebinding
    current_static=check_prebinding()
    assert json.loads((ROOT/'binding.json').read_text())['ready'] is False
    assert not (ROOT/'first-six-state.json').exists() and not (START/'execution-started.json').exists(), 'Never rebind an executed attempt'
    manifest=ROOT/'manifest.json'; prepared_manifest_sha=sha(manifest); frozen=json.loads(manifest.read_text())['files']
    for rel,proof in frozen.items():assert sha(ROOT/rel)==proof['sha256'] and (ROOT/rel).stat().st_mode&511==proof['mode'], 'Prepared input changed before binding: '+rel
    source_manifest=Path(a.source_manifest);build_result=Path(a.build_result)
    assert sha(source_manifest)==a.source_sha and sha(build_result)==a.build_sha
    source=json.loads(source_manifest.read_text());original_build=json.loads(build_result.read_text());adapter=json.loads((ROOT/'official-build-input-adapter.json').read_text());assert adapter['officialResult']=={'path':str(build_result),'sha256':a.build_sha};assert sha(Path(adapter['fieldSources']['nativeSmoke']['path']))==adapter['fieldSources']['nativeSmoke']['sha256'];build=adapter['oldShape'];assert build['sourceManifestSha256']==original_build['sourceManifestSHA256'];source_root=Path(source['source'])
    assert source_root.is_absolute() and source_root.is_dir()
    assert build['exitCode']==0 and build['actualApp']==str(APP) and build['sourceManifestSha256']==a.source_sha
    assert build['sourceShaModeBeforeAfterMatched'] is True
    smoke=build.get('nativeSmoke')
    if smoke is None:
        candidates=build.get('nativeSmokeRecords',[]);assert len(candidates)==1;smoke=candidates[0]
    assert (smoke['version'],smoke['platform'],smoke['arch'])==('0.1.1','darwin','arm64')
    assert all(smoke[k]=='passed' for k in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])
    assert 'native/applications/cli.mm' in source['files']
    # These are the source inputs used by the unchanged original installer/native scripts.
    source_files=['electron-builder.config.cjs','package.json','pnpm-lock.yaml','scripts/release/mac-bundle-metadata.cjs','scripts/release/native-smoke.cjs','native/applications/cli.mm']
    for name in source_files:
        f=source_root/name;assert not f.is_symlink() and sha(f)==source['files'][name] and f.stat().st_mode&511==source['modes'][name]
    info=plistlib.loads((APP/'Contents/Info.plist').read_bytes())
    assert info['CFBundleVersion']=='0.1.1'
    framework_info=plistlib.loads((APP/'Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist').read_bytes())
    assert framework_info['CFBundleVersion']=='42.11.14', 'Do not reuse explicit builder version for a different actual Electron'
    pending=json.loads((ROOT/'pending-pin-map.json').read_text()); critical=[]
    for name in pending['relativeCriticalPaths']:
        f=APP/name;assert f.is_file() and not f.is_symlink()
        critical.append({'path':name,'sha256':sha(f),'bytes':f.stat().st_size,'mode':f.stat().st_mode&511})
    bypath={x['path']:x for x in critical}
    actual_pins={'app.asar':bypath['Contents/Resources/app.asar']['sha256'],'executable':bypath['Contents/MacOS/WillYou']['sha256'],
        'stockCLI':bypath['Contents/Resources/native/willyou-app']['sha256'],'agent-browser':bypath['Contents/Resources/agent-browser/arm64/agent-browser']['sha256'],
        'identity':bypath['Contents/Resources/native/willyou-process-identity']['sha256']}
    assert all(build['pins'][k]==v for k,v in actual_pins.items()), 'Actual App differs from official result pins'
    index=json.loads((APP/'Contents/Resources/capability-bundles/index.json').read_text())
    browsers=[x for x in index['apps'] if x['appId']=='browser'];assert len(browsers)==1
    assert browsers[0]==pending['browserPackageExpectedUnchanged'], 'Browser manifest changed; Root must review applicability, do not silently rewrite original business expected'
    replacements={'__PENDING_SOURCE036_MANIFEST__':str(source_manifest),'__PENDING_SOURCE036_ROOT__':str(source_root),
        '__PENDING_SOURCE036_SHA__':a.source_sha,'__PENDING_SOURCE036_COUNT__':str(len(source['files'])),'__PENDING_BUILD_RESULT__':str(build_result),'__PENDING_BUILD_SHA__':a.build_sha}
    for marker,names in pending['markers'].items():
        values={bypath[n]['sha256'] for n in names};assert len(values)==1, 'Previously shared identity diverged; review exact references before binding'
        replacements[marker]=next(iter(values))
    before={'outerReady':sha(ROOT/'execution-ready.json'),'startupReady':sha(START/'execution-ready.json'),'pin':sha(START/'pin.json')}
    # Only copied static text inputs are substituted; no App/runtime/credential file is written.
    historical={row['path'] for row in json.loads((ROOT/'inherited-proof-references.json').read_text())['files']}
    managed=[ROOT/p for p in frozen if p not in ['binding.json','pending-pin-map.json','bind-App032-inputs.py','binding_guard.py','input-boundary.json','official-build-input-adapter.json','source036-inventory.projection.json','inherited-proof-references.json','parameter-only-proof.App031-reference.json'] and '/node_modules/' not in '/'+p and p not in historical and not p.startswith('binding-schema-review-001/')]
    for f in managed:
        try:text=f.read_text()
        except UnicodeDecodeError:continue
        for old,new in replacements.items():text=text.replace(old,new)
        f.write_text(text)
    pins=json.loads((ROOT/'evidence/prepackaged-input-pins.json').read_text());pins.update(source=str(APP),files=critical,binding='actual-App032-official-result-bound')
    for name in ['evidence/prepackaged-input-pins.json','evidence/attempt-002/prepackaged-input-pins.json']:save(ROOT/name,pins)
    # Installation gates remain pending after input binding. Phase06 alone may finalize them.
    pin=json.loads((START/'pin.template.json').read_text());assert pin['finalReady'] is False
    assert pin['buildGate']['sha256'] is None and pin['nativeGate']['sha256'] is None
    save(START/'pin.json',pin)
    ready=json.loads((START/'execution-ready.json').read_text())
    for f in ready['inputs']:
        p=START/f['path'];f['sha256']=sha(p);f['mode']=p.stat().st_mode&511
    ready.update(status='App032-inputs-bound-await-actual-installation-native6-phase06',sourceManifestSha256=a.source_sha,actualInstallationAndNativeBound=False)
    save(START/'execution-ready.json',ready)
    # Root must review this receipt before original phase01; it is no installation green.
    binding={'schema':'App032-S6-input-binding-v1','ready':True,'app':str(APP),'sourceManifest':str(source_manifest),'sourceManifestSha256':a.source_sha,
        'buildResult':str(build_result),'buildResultSha256':a.build_sha,'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'actualPins':actual_pins,'criticalFiles':len(critical),'preparedManifestSha256':prepared_manifest_sha,'installationOrStartupAccepted':False}
    save(ROOT/'binding.json',binding)
    # Same original prepared-input contract, plus this new file-only gate. No phase outputs are inputs.
    external=[]
    for name in pending['outerPreparedExternalTemplates']:
        
        for marker,value in replacements.items():name=name.replace(marker,value)
        external.append(row(Path(name)))
    local=[ROOT/p for p in frozen if p not in ['prepared-inputs.json','execution-ready.json','run-first-six.py','runner-manifest.json','input-binding-receipt.json','bound-input-manifest.json']]+[ROOT/'current-static-App032.json']
    inputs={x['path']:x for x in external+[row(p) for p in local]}
    prepared={'at':binding['at'],'scope':'Original App025 nine-stage workflow rebound to actual App032/source036, before any installer execution','nativeExecuted':False,
        'currentPackagePins':len(critical),'startupFrozenInputs':len(ready['inputs']),'sourceManifestSha256':a.source_sha,'inputs':list(inputs.values())}
    save(ROOT/'prepared-inputs.json',prepared);prepared_sha=sha(ROOT/'prepared-inputs.json')
    outer=json.loads((ROOT/'execution-ready.json').read_text());outer.update(status='READY-App032-bound-inputs-await-Root-full-installer-lease',sourceManifestSha256=a.source_sha,
        asarSha256=actual_pins['app.asar'],executableSha256=actual_pins['executable'],currentCriticalPins=len(critical))
    outer['verification']['currentAppBinding']=True
    outer['staticCurrentProof']='CurrentpurePythonAST/valuecontrols only; inheritedNodecontrols not reexecuted'
    outer['pureChecks']['currentPythonAST']={'path':str(ROOT/'current-static-App032.json'),'sha256':sha(ROOT/'current-static-App032.json')}
    outer['currentMain']=current_static['actualCurrentMain']
    outer['preparedInputs'].update(sha256=prepared_sha,files=len(inputs))
    for c in outer['commandsSequential']:c['shell']=c['shell'].replace('__PENDING_PREPARED_SHA__',prepared_sha)
    save(ROOT/'execution-ready.json',outer);ready_sha=sha(ROOT/'execution-ready.json')
    wrapper=ROOT/'run-first-six.py';wrapper.write_text(wrapper.read_text().replace('__PENDING_READY_SHA__',ready_sha))
    save(ROOT/'runner-manifest.json',{'at':binding['at'],'readySHA256':ready_sha,'preparedSHA256':prepared_sha,
        'wrapper':{'path':str(wrapper),'sha256':sha(wrapper)},'leaseMarker':'Root-App032-exclusive','resourcesHeld':False,
        'scope':'Original sequential01-06 only; actual inputs bound, no installer/native execution'})
    # No identity placeholder may reach an executable input; descriptive pending messages are retained.
    for f in [ROOT/'build-installer-002.py',START/'io.mjs',START/'run.mjs',START/'adjudicate.mjs',START/'pin.json']:
        assert not re.search(r'__PENDING_[A-Z0-9_]+__',f.read_text()), 'Unbound executable field: '+str(f)
    receipt={'at':binding['at'],'scope':'Pure-file actual App032 input binding only; no installer/native/App execution','before':before,
        'after':{'outerReady':ready_sha,'startupReady':sha(START/'execution-ready.json'),'pin':sha(START/'pin.json'),'prepared':prepared_sha},'bindingSha256':sha(ROOT/'binding.json'),
        'installedPinFinalReady':False,'allInstalledOutputGatesStillPending':True}
    save(ROOT/'input-binding-receipt.json',receipt)
    bound={p:{'sha256':sha(ROOT/p),'bytes':(ROOT/p).stat().st_size,'mode':(ROOT/p).stat().st_mode&511} for p in frozen}
    save(ROOT/'bound-input-manifest.json',{'originalPreparedManifestSha256':prepared_manifest_sha,'files':bound,'receiptSha256':sha(ROOT/'input-binding-receipt.json')})
    print(json.dumps({'outerReadySha256':ready_sha,'preparedSha256':prepared_sha,'bindingReceipt':str(ROOT/'input-binding-receipt.json'),'installedFinalReady':False}))
if __name__=='__main__':main()
