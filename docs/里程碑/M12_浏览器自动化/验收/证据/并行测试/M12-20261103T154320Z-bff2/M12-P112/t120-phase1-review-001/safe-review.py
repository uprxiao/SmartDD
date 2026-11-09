from pathlib import Path
import json,hashlib,datetime,re,urllib.parse,base64,collections,ast
root=Path('/private/tmp/willyou-m12-t120-phase1-independent-review-001');src=Path('/private/tmp/willyou-m12-t120-phase1-review-001/raw-phase1.private.json');rawbytes=src.read_bytes();assert hashlib.sha256(rawbytes).hexdigest()=='268fc230c72af1de4c5a2d44184d07a5c42007ab1a280674550b851d5a43cb60';raw=json.loads(rawbytes);p=raw['cases'][0]['phases'][0];ref=p['nativeSnapshotsBeforeStop'][0];nb=Path(ref['path']).read_bytes();assert hashlib.sha256(nb).hexdigest()==ref['sha256'];rows=[json.loads(x) for x in nb.decode().splitlines() if x];host={x['operation_id']:x for x in p['hostInvocations']};summary=json.loads((root/'phase1-summary.private.json').read_text());final=summary['final']['redactedText']
# Derive actual demonstration secret only locally, never include it or its digest in output.
fix=Path('/private/tmp/willyou-m12-t120-t125-sop-static-002/fixtures.mjs').read_text();m=re.search(r"demoAccounts\s*=\s*Object.freeze\(\{qa:'([^']+)'",fix);assert m;secret=m.group(1);variants=set([secret,urllib.parse.quote(secret,safe=''),base64.b64encode(secret.encode()).decode()])
def has_secret(x): return any(v in x for v in variants)
dec=json.JSONDecoder();seen_objects=[]
def nested(v,depth=0):
 if depth>10:return
 if isinstance(v,dict):
  seen_objects.append(v)
  for x in v.values():nested(x,depth+1)
 elif isinstance(v,list):
  for x in v:nested(x,depth+1)
 elif isinstance(v,str) and len(v)<=32*1024*1024:
  starts=[i for i,c in enumerate(v) if c in '{[']
  last=-1
  for i in starts:
   if i<last:continue
   try:x,n=dec.raw_decode(v[i:]);last=i+n;nested(x,depth+1)
   except (ValueError,RecursionError):pass
receipts={};locations=[]
for i,n in enumerate(rows,1):
 pl=n.get('payload',{});seen_objects=[];nested(pl)
 for o in seen_objects:
  if o.get('schema')=='willyou-app-result-v2' and isinstance(o.get('operation'),dict) and o['operation'].get('id') in host:
   op=o['operation']['id'];h=host[op]
   if o['operation'].get('requestId')==h['request_id'] and o.get('capabilityId')==h['tool_name']:receipts[op]={'receipt':o,'nativeLine':i,'nativeRole':pl.get('role'),'nativePayloadType':pl.get('type')}
 texts=[]
 def allstr(v,path=''):
  if isinstance(v,str):
   if has_secret(v):texts.append(path)
  elif isinstance(v,dict):
   for k,x in v.items():allstr(x,path+'/'+str(k))
  elif isinstance(v,list):
   for j,x in enumerate(v):allstr(x,path+'/'+str(j))
 allstr(pl)
 if texts:locations.append({'line':i,'type':pl.get('type'),'role':pl.get('role'),'fields':texts})
files=[];saved_receipts=[];privacy=[]
for f in p['site']['sources']:
 if 'content' in f:
  b=f['content'].encode();assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256']
 if '/artifacts/' not in f['path']:continue
 proof={'path':f['path'],'bytes':f['bytes'],'mode':f['mode'],'snapshotSha256':f['sha256'],'finalReferenced':f['path'] in final,'snapshotContentBound': 'content' in f}
 if f['path'].endswith(('.png','.har')):
  # Only exact immutable snapshot-pinned artifact. No mutable project source/live journal/SQL.
  b=Path(f['path']).read_bytes();assert len(b)==f['bytes'] and hashlib.sha256(b).hexdigest()==f['sha256'];proof['actualBytesMatchFrozenSnapshot']=True;proof['passwordPresent']=has_secret(b.decode(errors='ignore'))
  if f['path'].endswith('.png'):assert b[:8]==b'\x89PNG\r\n\x1a\n';proof['pngDimensionsPositive']=int.from_bytes(b[16:20],'big')>0 and int.from_bytes(b[20:24],'big')>0
 if 'content' in f and has_secret(f['content']):privacy.append({'name':Path(f['path']).name,'containsFixtureSecret':True})
 if f['path'].endswith('.json') and 'content' in f:
  try:v=json.loads(f['content'])
  except ValueError:v=None
  if isinstance(v,dict) and v.get('schema')=='willyou-app-result-v2' and isinstance(v.get('operation'),dict):
   h=host.get(v['operation'].get('id'));bound=bool(h and h['request_id']==v['operation'].get('requestId') and h['run_id']==p['actualRunId'] and h['task_id']==p['taskId'] and h['project_id']==p['projectId'] and h['tool_name']==v.get('capabilityId') and h['package_hash']==v.get('source',{}).get('packageHash'))
   saved_receipts.append({'file':Path(f['path']).name,'capability':v.get('capabilityId'),'status':v.get('status'),'hostBound':bound,'hostState':h.get('state') if h else None,'operationId':v['operation'].get('id'),'dataFile':v.get('data',{}).get('file')})
 files.append(proof)
# Match copied screenshot/har to actual receipt file hash, allowing report paths to be deliberate project-local copies.
copy_bindings=[]
for f in files:
 if not f['path'].endswith(('.png','.har')):continue
 matches=[x for x in saved_receipts if isinstance(x.get('dataFile'),dict) and x['dataFile'].get('sha256')==f['snapshotSha256'] and x['dataFile'].get('bytes')==f['bytes']]
 copy_bindings.append({'projectArtifact':f['path'],'finalReferenced':f['finalReferenced'],'actualSnapshotBound':f.get('actualBytesMatchFrozenSnapshot',False),'originalReceiptMatches':[{'file':x['file'],'capability':x['capability'],'hostBound':x['hostBound'],'originalArtifactPath':x['dataFile']['path']} for x in matches]})
counts=collections.Counter(x['tool_name'] for x in p['hostInvocations']);console=[x for x in saved_receipts if x['capability']=='browser.nav.console'];report=next(f for f in p['site']['sources'] if f['path'].endswith('/report.md'))
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'original-T120-requirement-gap-network-not-wholecase','scope':'frozen T120 before-stop copy only; T125/live journal/SQLite/Native not accessed','originalFieldMap':{'readBug':{'actualM10HostCounts':{k:v for k,v in counts.items() if k.startswith('zentao.')},'boundary':'Host proves calls; complete body/history/attachment bytes still require exact finite carrier lineage review, not inferred from call count'},'login':{'actualPageAccount':summary['browser']['account'],'snapshotAccountObserved':summary['browser']['snapshotAccountObserved'],'login303Observed':any(x['status']==303 and x['account']=='qa' for x in summary['browser']['loginPosts']),'stdinCarrierProof':'pending exact finite source/stdin derivation; old parser unsupported carrier is not absence proof'},'reproduction':{'actualTotal':'20.01','actualVersion':'fixture-v1','browserAndServerAgree':summary['browser']['total']=='20.01' and any(x['total']=='20.01' for x in summary['browser']['actualTotals'])},'fourOriginalEvidenceKinds':{'screenshotHostCount':counts['browser.nav.screenshot'],'consoleHostCount':counts['browser.nav.console'],'consoleSavedBound':len(console)>0 and all(x['hostBound'] and x['status']=='ok' for x in console),'networkHostCount':counts['browser.nav.network'],'captureStartHostCount':counts['browser.capture.start'],'captureStopHostCount':counts['browser.capture.stop'],'missing':['network actual command/capture required by original R08.1 step5; HAR is not console/network API substitution']},'finalSession':{'conclusion':summary['final']['conclusionReproduced'],'environmentUrl':summary['final']['literalEnvironmentUrlPresent'],'account':summary['final']['accountPresent'],'steps':summary['final']['stepValuesPresent'],'result':summary['final']['result2001'],'paths':len([x for x in files if x['finalReferenced']]),'password':summary['final']['passwordPresent']}},'savedReceiptBindings':saved_receipts,'projectArtifactCopyBindings':copy_bindings,'privacy':{'directFinalSecret':summary['final']['passwordPresent'],'savedTextFilesWithFixtureSecret':privacy,'snapshotPinnedArtifactsSecret':[{ 'path':f['path'],'containsFixtureSecret':f.get('passwordPresent',False)} for f in files if 'passwordPresent' in f],'nativeSensitiveLocations':locations,'boundary':'No secret values or secret digests in this output. A negative exact/URL/base64 local canary scan is bounded to this fixture, not a general absence-of-sensitive-data proof.'},'oracleExtraConstraints':[{'constraint':'every Host invocation succeeded','decision':'not original requirement; two read-only wait BROWSER_TIMEOUT attempts recovered and reproduction succeeded; retain errors separately'},{'constraint':'final references only original userdata artifact paths','decision':'overly narrow if project-local copy bytes match actual produced receipt SHA/bytes and frozen snapshot; verified copy chain recorded'}],'remaining':['actual original network evidence missing','finite AST/stdin and full-resource lineage not all closed by old parser','global normal exit/cleanup pending parent'], 'canProposeWholeCasePass':False,'formalCaseIncrement':0,'Native':0,'App':0,'SQL':0,'HTTP':0,'modelSend':0}
(root/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'fourEvidenceKinds':result['originalFieldMap']['fourOriginalEvidenceKinds'],'finalFields':result['originalFieldMap']['finalSession'],'savedReceipts':len(saved_receipts),'allSavedReceiptsHostBound':all(x['hostBound'] for x in saved_receipts),'copyBindingCounts':[{ 'suffix':Path(x['projectArtifact']).name,'matches':len(x['originalReceiptMatches']),'actualSnapshotBound':x['actualSnapshotBound'],'finalReferenced':x['finalReferenced']} for x in copy_bindings],'privacyCounts':{'nativeLocations':len(locations),'savedTextFilesWithSecret':len(privacy),'artifactSecret':sum(f.get('passwordPresent',False) for f in files)},'Native':0},ensure_ascii=False))
