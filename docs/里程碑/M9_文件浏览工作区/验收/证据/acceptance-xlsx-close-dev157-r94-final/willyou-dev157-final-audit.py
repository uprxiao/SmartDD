from pathlib import Path
import datetime,gzip,hashlib,json,shutil,tarfile
repo=Path.cwd();base=repo/'docs/里程碑/M9_文件浏览工作区';p=base/'验收/证据/m9-acceptance-xlsx-close-dev157-r94-20261020.json';r=json.loads(p.read_text());h=lambda b:hashlib.sha256(b).hexdigest();assert h(p.read_bytes())=='180957801e13dbfe26634bcfc7d357216f39b0d2acb47608df50bc0275756fad'
for item in r['artifacts'].values():
 b=(repo/item['path']).read_bytes();assert len(b)==item['bytes']and h(b)==item['sha256']
 if item.get('compression')=='gzip':b=gzip.decompress(b);assert len(b)==item['originalBytes']and h(b)==item['originalSha256']
source=json.load(open('/private/tmp/willyou-dev157-source-delta.json'));pre=json.load(open('/private/tmp/willyou-dev157-prebuild-source.json'));delta=set(source['changedParentFiles'])|set(source['newFiles']);assert len(delta)==8
with tarfile.open(pre['tar'],'r:gz')as full,tarfile.open(source['tar'],'r:gz')as patch:
 for name,digest in source['files'].items():assert h((repo/name).read_bytes())==digest and h((patch if name in delta else full).extractfile(name).read())==digest
 for name,digest in pre['files'].items():assert h(full.extractfile(name).read())==digest
before=json.load(open('/private/tmp/willyou-dev157-cases-before.json'));after=json.loads((base/'验收/用例覆盖索引.json').read_text());changes=[]
for a,b in zip(before['cases'],after['cases']):
 assert a['id']==b['id']
 if a!=b:changes.append(b['id'])
 for field in a:
  if field not in {'status','evidence','actual_result','defects','prototype_status','prototype_note'}:assert a[field]==b[field]
assert changes==['M9-T-J10'];cur=[x for x in after['cases']if x['scope']!='future-remote'];counts={s:sum(x['status']==s for x in cur)for s in ['通过','未执行','阻塞']};assert len(after['cases'])==425 and len(cur)==419 and counts=={'通过':265,'未执行':151,'阻塞':3}
tests=json.load(open('/private/tmp/willyou-dev157-code-r94-final.json'));names=[s['name']+'::'+a['fullName']for s in tests['testResults']for a in s['assertionResults']];assert len(names)==len(set(names))==111 and tests['numFailedTests']==tests['numPendingTests']==0;native=json.load(open('/private/tmp/willyou-dev157-native-r94-I.json'));assert len(native['rows'])==7 and all(x['pass']for x in native['rows']);proof=json.load(open('/private/tmp/willyou-dev157-v8-audit.json'));assert proof['status']=='passed'and proof['checks']==14 and proof['originalPayloads']==174 and proof['originalErrors']==6;proc=json.load(open('/private/tmp/willyou-dev157-process-audit.json'));assert len(proc['runs'])==3 and all(x['pidAbsent']and not x['ownProfileProjectMatches']for x in proc['runs']);pack=json.load(open('/private/tmp/willyou-dev157-r94-fast-package-result.json'));assert pack['status']=='passed';runtime=json.load(open('/private/tmp/willyou-dev157-runtime-r94.log'));assert len(runtime['files'])==82
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','reportSha256':h(p.read_bytes()),'artifactHashesVerified':len(r['artifacts']),'recoveryInputsVerified':len(source['files']),'deltaFiles':len(delta),'onlyChangedCase':changes,'currentTotal':419,'counts':counts,'percentage':round(265/419*100,2),'distinctCodeTests':111,'nativeScenarios':7,'appChecks':14,'originalPayloadsVerified':174,'originalErrors':6,'ownedAppRunsGone':3,'runtimeFilesVerified':82,'boundary':'Main98 artifacts remain immutable; docs writer and this audit are supplementary. No production/native/build/deps/P/version changes after r94, no release. Goal remains active;151unexecuted+3blocked retained.'};out=base/'验收/证据/acceptance-xlsx-close-dev157-r94-final'
for file in ['/private/tmp/willyou-dev157-docs.py','/private/tmp/willyou-dev157-final-audit.py']:shutil.copy2(file,out/Path(file).name)
q=Path('/private/tmp/willyou-dev157-final-audit.json');q.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');shutil.copy2(q,out/q.name);print(json.dumps(result,ensure_ascii=False))
