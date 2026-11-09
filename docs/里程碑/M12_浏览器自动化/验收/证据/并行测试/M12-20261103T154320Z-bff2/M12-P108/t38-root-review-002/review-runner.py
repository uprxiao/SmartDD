from pathlib import Path
import json,hashlib,subprocess,os,difflib,datetime
s=Path('/private/tmp/willyou-m12-t131-t38-peer-ar-001');o=Path('/private/tmp/willyou-m12-t131-t38-root-review-002');o.mkdir(exist_ok=False);sha=lambda b:hashlib.sha256(b).hexdigest()
m=json.loads((s/'safe-delivery/manifest.json').read_text())
for f in m['files']:
 assert f['safeForRepo'] is True
 p=s/'safe-delivery'/f['path'];assert sha(p.read_bytes())==f['sha256'];assert p.stat().st_size==f['bytes']
r=json.loads((s/'execution-ready.json').read_text());print('input schema',type(r['inputs']).__name__,len(r['inputs']))
# Only inspect the pinned source/input records, never serialize actual runtime secrets.
inputs=r['inputs']
for f in inputs:
 p=s/f['path'];assert sha(p.read_bytes())==f['sha256'],f['path']
 if 'mode' in f:assert (p.stat().st_mode&0o777)==(int(f['mode'],8) if isinstance(f['mode'],str) else f['mode']),f['path']
changes=[]
for name,output in [('judge.mjs','judgement.json'),('check-finished-cli.mjs','finite-decoder-controls.json')]:
 p=s/'supplemental-review-001'/name;before=p.read_text();after=before
 for imp in ['../io.mjs','../plan-reader.mjs','../skill-files-proof.mjs','../skill-delivery.mjs','../native-journal.mjs','./t38-oracle.mjs','./finished-cli-text.mjs']:
  after=after.replace("'"+imp+"'","'"+(p.parent/imp).resolve().as_uri()+"'")
 old="ROOT+'/supplemental-review-001/"+output+"'";assert after.count(old)==1;after=after.replace(old,json.dumps(str(o/output)))
 q=o/name;q.write_text(after);changes.append({'file':name,'originalSha256':sha(before.encode()),'replaySha256':sha(after.encode()),'scope':'absolute original imports and output target only; original input paths, expected values, predicates unchanged'})
 (o/(name+'.diff')).write_text(''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile=str(p),tofile=str(q))))
env=dict(os.environ,WILLYOU_TEST_CACHE_DIR=str(s/'cache'),NODE_COMPILE_CACHE=str(s/'cache/node'));runs=[]
for name,want in [('judge.mjs',1),('check-finished-cli.mjs',0)]:
 cmd=['/Users/liubu/.hermes/node/bin/node',str(o/name),'--judge']
 z=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=30);(o/(name+'.stdout.log')).write_text(z.stdout);(o/(name+'.stderr.log')).write_text(z.stderr);assert z.returncode==want,(name,z.returncode);runs.append({'command':cmd,'actualExit':z.returncode,'expectedExit':want})
d=json.loads((o/'judgement.json').read_text());assert d['decision']['passed']==8 and d['decision']['total']==9;assert all(c['passed'] for c in d['decision']['checks'][:8]);assert d['decision']['checks'][8]['passed'] is False
c=json.loads((o/'finite-decoder-controls.json').read_text());assert c['passed']==11 and all(x['passed'] for x in c['tests'])
cl=json.loads((s/'cleanup-verification.json').read_text());assert cl['allClear'] and len(cl['checks'])==49 and all(x['clear'] for x in cl['checks'])
raw=json.loads((s/'raw.private.json').read_text());assert raw['appExit']['pid']==7347 and raw['appExit']['code']==0 and raw['appExit']['signal'] is None;assert raw['cleanupErrors']==[] and raw['persistenceErrors']==[]
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'file-only independent reparse; no business replay','originalInputsVerified':len(inputs),'safeDeliveryVerified':len(m['files']),'sourceSafeManifestSha256':sha((s/'safe-delivery/manifest.json').read_bytes()),'replayChanges':changes,'runs':runs,'businessConditions':{'passed':8,'total':8},'originalSupplementalOracle':{'passed':8,'total':9,'privacyRemainsRed':True},'decoderControls':11,'cleanupChecks':49,'formalParentIncrement':0,'notClaimed':['no private runtime token persistence','whole T131 passed','OpenAI R','all fault cases use unchanged OS facts']}
(o/'coordinator-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
