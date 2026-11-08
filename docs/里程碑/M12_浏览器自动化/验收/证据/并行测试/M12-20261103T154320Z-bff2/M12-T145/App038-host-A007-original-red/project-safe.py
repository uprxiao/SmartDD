from pathlib import Path
import json,hashlib,shutil,collections,datetime
P=Path('/private/tmp/willyou-m12-t145-App038-host-renderer-A-007');Q=Path('/private/tmp/willyou-m12-t145-App038-host20-review-001');O=P/'safe-delivery-001';O.mkdir(mode=0o700,exist_ok=False)
H=lambda b:hashlib.sha256(b).hexdigest();refs=[];copies=[];omissions=[]
def put(n,v):
 p=O/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n'if not isinstance(v,str)else v);p.chmod(0o600)
def ref(p,role):
 b=p.read_bytes();x={'path':str(p),'sha256':H(b),'bytes':len(b),'mode':p.stat().st_mode&511,'role':role};refs.append(x);return x
# This projector does not inspect other runtime contents or credentials.
def copy(p,n,role):
 x=ref(p,role);q=O/n;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(p.read_bytes());q.chmod(p.stat().st_mode&511);copies.append({'target':n,'original':str(p),'originalSHA256':x['sha256'],'byteIdentical':True})
def safe(v,path=''):
 if isinstance(v,dict):
  out={}
  for k,x in v.items():
   q=path+'.'+k
   if k in ['runtimeSnapshot','config','env','environment','injectedEnvNames','argv','previewDataURL','dataURL','endpoint','token','secret','password','secretValues']:
    omissions.append(q);continue
   out[k]=safe(x,q)
  return out
 if isinstance(v,list):return[safe(x,path+'['+str(i)+']')for i,x in enumerate(v)]
 if isinstance(v,str):
  if v.startswith('data:'):return{'kind':'data-url','sha256':H(v.encode()),'characters':len(v),'originalValuePrivate':True}
  if v.startswith('/tmp/wy-')or v.startswith('/private/tmp/wy-'):return{'kind':'exact-owned-runtime-path','sha256':H(v.encode()),'originalValuePrivate':True}
  if '/runtime-001/'in v or '/home/'in v and v.startswith('/private/tmp/'):
   return{'kind':'own-private-fixture-path-or-text','sha256':H(v.encode()),'characters':len(v),'originalValuePrivate':True}
 return v
r=json.loads((P/'raw.json').read_text());ready=json.loads((P/'READY.json').read_text());judge=json.loads((P/'judgement.json').read_text());cleanup=json.loads((P/'cleanup.json').read_text());review=json.loads((Q/'review.json').read_text());index=json.loads((P/'visual-evidence-index.json').read_text())
# Original A PNGs and synthetic renderer metadata remain exact bytes. No
# runtime snapshot/config/env/auth exists in these metadata files (field-only check).
for item in r['captures']:
 name=item['image']['path'];meta=Path(name).with_suffix('.json').name
 copy(P/name,'captures/'+name,'Original synthetic A PNG, raw DPR2 unchanged')
 copy(P/meta,'captures/'+meta,'Original all-synthetic renderer metadata, no runtime secret/config fields')
for n in ['judgement.json','visual-evidence-index.json','root-original-image-review.json','root-wrapper-cleanup.safe.json','root-awake-start.json','root-awake-cleanup.json','actual-package-binding.json','package-pin.json','source-proof.json','park-lifecycle-source-proof.json','original-contract.json','group.json','references.json','driver-file-access-map.json','static-result.json','READY.json','manifest.json','clone-provenance.json','retarget-review.json','initial-activation-authorization.json']:
 copy(P/n,'original/'+n,'Original actual result, admission or frozen identity evidence')
for n in ['review.json','report.md','manifest.json']:copy(Q/n,'independent-host20-review/'+n,'Existing independent saved-image/style review; not new review')
# Minimal recoverable driver: exact local frozen source/helper/input closure.
for f in ready['inputs']:
 p=Path(f['path']);
 if not p.is_relative_to(P):continue
 rel=p.relative_to(P)
 if rel.parts[0]in ['runtime-001','node_modules','cache','static-cache','judge-cache','cleanup-cache']:continue
 if p.suffix in ['.mjs','.py','.applescript','.json','.md','.diff']and p.name not in ['READY.json','manifest.json']:
  target='driver/'+str(rel)
  if not (O/target).exists():copy(p,target,'Exact original frozen local driver/input; not executed by projection')
# Explicit helper sources not necessarily separate READY members retain identity.
for n in ['README.md','root-run-with-awake.py','receiver.py','run.mjs','judge.mjs','judge-visual.mjs','cleanup.mjs']:
 if not (O/'driver'/n).exists():copy(P/n,'driver/'+n,'Original reproducible coordinator/producer/checker source')
rawref=ref(P/'raw.json','Private full raw hash only; no raw original copied')
projected={k:safe(v,k)for k,v in r.items()if k not in ['captures','closedTasks','resourceHistory','exactGatewayPaths','port','url','userData']}
projected['captures']=[{'combo':x['combo'],'state':x['state'],'taskId':x['taskId'],'runId':x['runId'],'pageId':x['pageId'],'profileId':x['profileId'],'at':x['at'],'image':x['image'],'metadata':'captures/'+Path(x['image']['path']).with_suffix('.json').name,'originalCaptureSHA256':H(json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())}for x in r['captures']]
projected['closedTasks']=[{'combo':x.get('combo'),'result':{k:x['result'].get(k)for k in ['id','ptyId','nativeSessionId','recovery','archived']if k in x.get('result',{})}}for x in r.get('closedTasks',[])]
projected['resourceHistory']=[{'at':x.get('at'),'processes':[{k:y.get(k)for k in ['pid','ppid','birth']}for y in x.get('processes',[])],'helpers':[{k:y.get(k)for k in ['pageId','pids','names']}for y in x.get('helpers',[])]}for x in r.get('resourceHistory',[])]
projected['exactOwnedGatewayPathHashes']=[H(x.encode())for x in r.get('exactGatewayPaths',[])];projected['privateEndpointCount']=len(r.get('knownPorts',[]));projected['originalRawSHA256']=rawref['sha256'];projected['projectionBoundary']='All-synthetic visual evidence. Original raw retained privately; closed-task runtimeSnapshot/config/env and exact runtime endpoints removed. Capture PNG/metadata copied as original bytes; no wholeT145 pass.'
put('raw.safe.json',projected)
cr=ref(P/'cleanup.json','Original exact resource check hash; projected below')
put('cleanup.safe.json',{'originalSHA256':cr['sha256'],'at':cleanup.get('at'),'allClear':cleanup['allClear'],'counts':dict(collections.Counter(x['kind']for x in cleanup['checks'])),'checks':[safe({k:v for k,v in x.items()if k not in ['stdout','stderr']})for x in cleanup['checks']],'stdoutStderrRetainedPrivately':True,'originalNormalExit':r['appExit'],'observedProcess':safe(r['observedProcess'])})
# Whole immutable lists are safe hash references; no Node, binary, full source,
# private build/Electron log, auth, home, DB or runtime trees enter the delivery.
put('frozen-input-hashes.json',{'READYOriginalSHA256':H((P/'READY.json').read_bytes()),'inputs':ready['inputs'],'dependencyLinks':ready.get('links',[]),'externalFilesCopied':False,'restoration':'Restore exact original paths/bytes/modes and per-package links from this list before any future separately authorized execution; safe directory itself is not an execution root.'})
log=P/'electron.private.log'
if log.exists():ref(log,'Private complete log excluded; SHA only')
for pair in index:
 for kind in ['P']:
  for key in ['path','metadataPath']:
   path=pair.get(kind,{}).get(key)
   if path:
    q=Path(path)
    # Only a provenance reference from existing index, no extra P image copy.
    refs.append({'path':path,'sha256':pair[kind].get('sha256'if key=='path'else'metadataSHA256'),'role':'Existing P reference from original visual index; not newly reviewed or copied'})
put('delivery-summary.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'case':'M12-T145','scope':'A007 original20 host renderer captures only, original57x8 retained','source':'App038/source045','originalAImages':len(r['captures']),'originalAMetadata':len(r['captures']),'mechanicalJudge':{'passed':judge['passed'],'total':judge['total'],'status':judge['status']},'existingRootReview':'original/root-original-image-review.json','independentReview':'independent-host20-review/review.json','confirmedNarrowB12RedKeys':review['confirmedClippedKeys'],'existingReviewScope':{'all40PNGAndMetadataSHAAndDimensionsVerified':review['all40PNGAndMetadataSHAAndDimensionsVerified'],'all16DialogSampledStylesEqual':review['all16DialogSampledStylesEqual'],'all16ShadowPresentAndSame':review['all16ShadowPresentAndSame']},'differencesNotPromotedToPass':['settings actual0MB disabled versus P12.4MB enabled','launcher control focus mismatch','dynamic task/profile text and synthetic fixture differences','P-only controls','P4px frame/runtime32 shell geometry and DPR1-vs2 interpretation'], 'wholeT145Pass':False,'formalIncrement':0,'AppExit':r['appExit'],'signals':r['observedProcess']['signals'],'resourceAllClear':cleanup['allClear'],'actualExecutionByProjector':False,'resourcesHeld':0,'projectionDidNotReevaluateVisuals':True})
put('provenance.json',{'sourceRoot':str(P),'originals':refs,'copiedMembers':copies,'removedFields':omissions,'excluded':['App/binaries/DMG','node_modules contents','home/userData/DB/auth','all runtime directory trees','raw original and full Electron/build logs','full runtimeSnapshot/config/env','exact socket endpoints'],'originalsChanged':False,'publicLedgerChanged':False})
(O/'project-safe.py').write_bytes(Path('/private/tmp/project-T145-A007-safe.py').read_bytes())
files=[{'path':p.relative_to(O).as_posix(),'bytes':p.stat().st_size,'sha256':H(p.read_bytes())}for p in sorted(O.rglob('*'))if p.is_file()]
put('manifest.json',{'scope':'M12-T145-App038-A007-safe-delivery-001','files':files,'wholeT145Pass':False,'formalIncrement':0,'resourcesHeld':0})
print(json.dumps({'safeRoot':str(O),'manifestSHA256':H((O/'manifest.json').read_bytes()),'files':len(files),'PNGs':len(list((O/'captures').glob('*.png'))),'metadata':len(list((O/'captures').glob('*.json'))),'preservedB12Red':review['confirmedClippedKeys'],'resources':0},ensure_ascii=False))
