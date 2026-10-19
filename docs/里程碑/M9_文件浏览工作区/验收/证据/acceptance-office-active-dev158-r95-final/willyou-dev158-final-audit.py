from pathlib import Path
import datetime,gzip,hashlib,json,shutil,tarfile
root=Path.cwd();base=root/'docs/里程碑/M9_文件浏览工作区';rp=base/'验收/证据/m9-acceptance-office-active-dev158-r95-20261020.json';h=lambda b:hashlib.sha256(b).hexdigest();assert h(rp.read_bytes())=='91d07eb15a411469f1529b5587f531c89abeb2a408ff25326e9599aa5968ccf0';r=json.loads(rp.read_text())
for x in r['artifacts'].values():
 b=(root/x['path']).read_bytes();assert len(b)==x['bytes']and h(b)==x['sha256']
 if x.get('compression')=='gzip':b=gzip.decompress(b);assert len(b)==x['originalBytes']and h(b)==x['originalSha256']
source=json.load(open('/private/tmp/willyou-dev158-source-delta.json'));delta=set(source['changedParentFiles'])|set(source['newFiles']);assert len(delta)==8 and len(source['files'])==1340
with tarfile.open(source['fullPrebuild'],'r:gz')as full,tarfile.open(source['tar'],'r:gz')as patch:
 for name,digest in source['files'].items():assert h((root/name).read_bytes())==digest and h(full.extractfile(name).read())==digest and(name not in delta or h(patch.extractfile(name).read())==digest)
before=json.load(open('/private/tmp/willyou-dev158-cases-before.json'));after=json.loads((base/'验收/用例覆盖索引.json').read_text());changed=[]
for a,b in zip(before['cases'],after['cases']):
 assert a['id']==b['id']
 for k in a:
  if k not in {'status','evidence','actual_result','defects','prototype_status','prototype_note'}:assert a[k]==b[k],(a['id'],k)
 if a['status']!=b['status']:changed.append(b['id'])
assert changed==['M9-T-J02','M9-T-W28'];cur=[x for x in after['cases']if x['scope']!='future-remote'];counts={s:sum(x['status']==s for x in cur)for s in ['通过','未执行','阻塞']};assert len(after['cases'])==425 and len(cur)==419 and counts=={'通过':267,'未执行':149,'阻塞':3};tests=json.load(open('/private/tmp/willyou-dev158-code-r95-final.json'));names=[s['name']+'::'+a['fullName']for s in tests['testResults']for a in s['assertionResults']];assert len(names)==len(set(names))==174 and tests['numFailedTests']==tests['numPendingTests']==0;audit=json.load(open('/private/tmp/willyou-dev158-v8-audit.json'));assert audit['status']=='passed'and audit['appChecks']==32 and audit['originalPayloads']==562 and audit['workerThreadsExited']==64;proc=json.load(open('/private/tmp/willyou-dev158-process-audit.json'));assert len(proc['runs'])==6 and all(x['pidAbsent']and not x['ownProfileProjectMatches']for x in proc['runs']);assert len(json.load(open('/private/tmp/willyou-dev158-runtime-r95.log'))['files'])==82
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','reportSha256':h(rp.read_bytes()),'artifactHashesVerified':len(r['artifacts']),'recoveryInputsVerified':1340,'deltaFiles':8,'changedStatusesThisGoalTurn':changed,'currentTotal':419,'counts':counts,'percentage':round(267/419*100,2),'distinctCodeTests':174,'nativeScenarios':16,'appChecks':32,'originalV8Payloads':562,'trustedFocusedHandledKeys':46,'officeWorkerThreadsExited':64,'ownedRunsGone':6,'runtimeFilesVerified':82,'boundary':'Main183 artifacts immutable; docs and final audit supplementary. All engineering inputs match r95 BEFORE build, no post-build production changes. Entire original419 scope unchanged;149unexecuted+3blocked retain limitations, M9 not complete/no release. Goal stays active for independent remaining cases.'};out=base/'验收/证据/acceptance-office-active-dev158-r95-final';p=Path('/private/tmp/willyou-dev158-final-audit.json');p.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for f in [p,Path(__file__),Path('/private/tmp/willyou-dev158-docs.py')]:shutil.copy2(f,out/f.name)
print(json.dumps(result,ensure_ascii=False))
