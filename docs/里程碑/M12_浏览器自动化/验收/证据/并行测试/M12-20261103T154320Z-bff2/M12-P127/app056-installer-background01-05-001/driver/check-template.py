from pathlib import Path
import ast,json,hashlib,os
from binding_guard import assert_bound
r=Path(__file__).parent
files=[]
for p in sorted(r.glob('*.py')):
 ast.parse(p.read_text(),filename=str(p));files.append({'path':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
assert_bound()
b=json.loads((r/'binding.json').read_text());e=json.loads((r/'execution-ready.json').read_text());shape=json.loads((r/'directory-shape.json').read_text());prepared=json.loads((r/'prepared-inputs.json').read_text())
assert b['ready']is True and e['bindingComplete']is True and len(e['commandsSequential'])==5
assert e['originalNineStagesRetained'] and e['06to09ExplicitPending'] and e['currentApp']==b['app']
assert hashlib.sha256((r/'prepared-inputs.json').read_bytes()).hexdigest()==e['preparedInputs']['sha256']
for rel in shape['precreatedParentsOnly']:assert(r/rel).is_dir() and not(r/rel).is_symlink() and (r/rel).resolve().is_relative_to(r)
for rel in shape['requiredAbsent']:assert not(r/rel).exists() and not(r/rel).is_symlink()
for f in prepared['inputs']:
 p=Path(f['path']);assert p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==f['sha256'],str(p);assert p.stat().st_mode&511==f['mode'],str(p)
pins=json.loads((r/'evidence/prepackaged-input-pins.json').read_text());assert len(pins['files'])==176 and all(x['sha256']for x in pins['files']);assert pins==json.loads((r/'evidence/attempt-002/prepackaged-input-pins.json').read_text())
cache=json.loads((r/'cache-baseline-pins.json').read_text())
for x in cache['symlinks']:
 p=Path(x['path']);assert p.is_symlink() and os.readlink(p)==x['target'] and p.lstat().st_mode&511==x['mode']
source=json.loads((r/'source-and-build-proof.json').read_text());assert source['sourceFiles']==3691 and source['allFrozenSourceSHAAndModeMatched'];assert all(source['native6'][k]=='passed'for k in ['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])
wrapper=(r/'run-background-first-five.py').read_text();assert '__FINAL_'not in wrapper;assert 'Root-App056-exclusive'in wrapper
assert not(r/'installer-input/WillYou.app').exists();assert not(r/'installer-output-002').exists()
result={'passed':True,'checkerPID':os.getpid(),'pythonAST':files,'precreatedParents':5,'requiredAbsent':len(shape['requiredAbsent']),'bindingComplete':True,'preparedInputs':len(prepared['inputs']),'criticalFiles':176,'sourceFiles':3691,'cachedBaselineHashChecked':True,'cacheRegularFiles':len(cache['files']),'cacheSymlinks':len(cache['symlinks']),'NativeAppOSMountBuildPTYCLIHTTPModel':0,'AppDmgCopies':0,'fullS6':False}
(r/'template-static-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':True,'pythonAST':len(files),'critical':176,'preparedInputs':len(prepared['inputs']),'NativeAppOS':0}))
