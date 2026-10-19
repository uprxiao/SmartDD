from pathlib import Path
import datetime,gzip,hashlib,json,shutil,tarfile
root=Path.cwd();base=root/'docs/里程碑/M9_文件浏览工作区';rp=base/'验收/证据/m9-acceptance-document-identity-dev160-r96-20261020.json';h=lambda b:hashlib.sha256(b).hexdigest();assert h(rp.read_bytes())=='6c16230a356f5b310776be84ad6a6298fbc6240c9be73e40fe4f45983d42d96c';r=json.loads(rp.read_text())
for x in r['artifacts'].values():
 b=(root/x['path']).read_bytes();assert len(b)==x['bytes']and h(b)==x['sha256']
 if x.get('compression')=='gzip':b=gzip.decompress(b);assert len(b)==x['originalBytes']and h(b)==x['originalSha256']
source=json.load(open('/private/tmp/willyou-dev160-source-delta.json'));pre=json.load(open('/private/tmp/willyou-dev160-r96-prebuild-source.json'));delta=set(source['changedParentFiles'])|set(source['newFiles']);assert len(delta)==6 and len(source['files'])==1342 and set(source['postBuildChanges'])=={'src/main/core/files/symlink-acceptance.test.ts'}
with tarfile.open(source['fullPrebuild'],'r:gz')as full,tarfile.open(source['tar'],'r:gz')as patch:
 for name,digest in source['files'].items():assert h((root/name).read_bytes())==digest and h((patch if name in delta else full).extractfile(name).read())==digest
 for name,digest in pre['files'].items():assert h(full.extractfile(name).read())==digest
before=json.load(open('/private/tmp/willyou-dev160-cases-before.json'));after=json.loads((base/'验收/用例覆盖索引.json').read_text());changes=[]
for a,b in zip(before['cases'],after['cases']):
 assert a['id']==b['id']
 if a!=b:changes.append(b['id'])
 for k in a:
  if k not in {'status','evidence','actual_result','defects','prototype_status','prototype_note'}:assert a[k]==b[k]
assert changes==['M9-T-D05'];cur=[x for x in after['cases']if x['scope']!='future-remote'];counts={s:sum(x['status']==s for x in cur)for s in ['通过','未执行','阻塞']};assert len(after['cases'])==425 and len(cur)==419 and counts=={'通过':268,'未执行':148,'阻塞':3};audit=json.load(open('/private/tmp/willyou-dev160-result-audit.json'));assert audit['status']=='passed'and audit['distinctCodeTests']==57 and audit['appMatrixGroups']==4 and audit['prototypeMatrixGroups']==2 and audit['originalJsonOutputsChecked']==89;assert len(json.load(open('/private/tmp/willyou-dev160-runtime-r96.json'))['files'])==82;proc=json.load(open('/private/tmp/willyou-dev160-process-audit.json'));assert len(proc['runs'])==13 and proc['ownVolumesDetached']==16
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','reportSha256':h(rp.read_bytes()),'artifactHashesVerified':len(r['artifacts']),'recoveryInputsVerified':1342,'deltaFiles':6,'postBuildTestOnlyFiles':list(source['postBuildChanges']),'onlyChangedCase':changes,'currentTotal':419,'counts':counts,'percentage':round(268/419*100,2),'distinctCodeTests':57,'nativeIdentityScenarios':8,'prototypeModelTests':2,'appMatrixGroups':4,'appNavigationChecks':24,'prototypeMatrixGroups':2,'originalJsonOutputsChecked':89,'uniqueClickableTreeSelections':26,'ownAppsGone':13,'ownVolumesDetached':16,'runtimeFilesVerified':82,'boundary':'Main124 artifacts immutable, docs/final-audit supplemental. Original scope/steps/expected/environment preserved. OnlyD05statusadvances;148unexecuted+3blocked remain. M9 not complete/no release, activegoal continues.'};out=base/'验收/证据/acceptance-document-identity-dev160-r96-final';p=Path('/private/tmp/willyou-dev160-final-audit.json');p.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for f in [p,Path(__file__),Path('/private/tmp/willyou-dev160-docs.py')]:shutil.copy2(f,out/f.name)
print(json.dumps(result,ensure_ascii=False))
