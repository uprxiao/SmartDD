from pathlib import Path
import json,hashlib,sys,datetime
R=Path(__file__).resolve().parent
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
key=json.loads((R/'user-key.json').read_text());bound='--bind' in sys.argv
if bound:
 assert key['status']=='bound-user-confirmed' and isinstance(key['shortcut'],str) and key['shortcut'] and key['shortcut']==key['shortcut'].strip() and isinstance(key['userMessageReference'],str) and key['userMessageReference']
else: assert key['status']=='pending-user-answer' and key['shortcut'] is None
for n in ['runtime-001','raw.json','live.json','lease.receipt.json','static.json','human-request.json']:
 assert not (R/n).exists(),n
inputs={}
for f in json.loads((R/'external-inputs.json').read_text()):
 p=Path(f['path']);assert sha(p)==f['sha256'] and p.stat().st_mode&511==f['mode'];inputs[str(p)]=f
for p in R.rglob('*'):
 if p.is_file() and 'node_modules' not in p.parts and p.name not in ['ready.json','manifest.json']:
  inputs[str(p)]={'path':str(p),'sha256':sha(p),'mode':p.stat().st_mode&511}
ready={'schema':'M12-P09-known-user-shortcut-v2','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'privateRoot':str(R),'bindingReady':bound,'bindingStatus':'user-key-bound-static-not-yet-qualified' if bound else 'pending-user-key-no-execution','scope':'Same original Home Mic/new synthetic text only; private override/pre-user readiness correction','inputs':sorted(inputs.values(),key=lambda x:x['path']),'actualNodeNativeAppOS':0,'static':f'NODE_COMPILE_CACHE={R}/cache/static-node WILLYOU_TEST_CACHE_DIR={R}/cache /Users/liubu/.hermes/node/bin/node {R}/static.mjs','execute':f'NODE_COMPILE_CACHE={R}/cache/node WILLYOU_TEST_CACHE_DIR={R}/cache /Users/liubu/.hermes/node/bin/node {R}/run.mjs --execute'}
(R/'ready.json').write_text(json.dumps(ready,ensure_ascii=False,indent=2)+'\n')
manifest={'privateRoot':str(R),'scope':'Pending configuration prep only, no test executed','readySHA256':sha(R/'ready.json'),'members':[{'path':str(p.relative_to(R)),'sha256':sha(p),'bytes':p.stat().st_size}for p in sorted(R.rglob('*'))if p.is_file() and 'node_modules' not in p.parts and p.name!='manifest.json']}
(R/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'readySHA256':sha(R/'ready.json'),'manifestSHA256':sha(R/'manifest.json'),'bindingReady':bound,'checkerSHA256':sha(R/'static.mjs'),'inputs':len(inputs)}))
