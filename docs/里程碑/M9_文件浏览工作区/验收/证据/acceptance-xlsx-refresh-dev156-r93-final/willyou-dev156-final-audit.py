from pathlib import Path
import datetime,gzip,hashlib,json,tarfile,shutil
repo=Path.cwd();base=repo/'docs/里程碑/M9_文件浏览工作区';p=base/'验收/证据/m9-acceptance-xlsx-refresh-dev156-r93-20261020.json';r=json.loads(p.read_text());h=lambda b:hashlib.sha256(b).hexdigest()
assert h(p.read_bytes())=='8043f17840e75aaaccd7a315df418a2bd7c2e175c246289979ea489f828cc392'
for item in r['artifacts'].values():
 content=(repo/item['path']).read_bytes();assert len(content)==item['bytes']and h(content)==item['sha256']
 if item.get('compression')=='gzip':raw=gzip.decompress(content);assert len(raw)==item['originalBytes']and h(raw)==item['originalSha256']
source=json.load(open('/private/tmp/willyou-dev156-source-delta.json'));pre=json.load(open('/private/tmp/willyou-dev156-r93-prebuild-source.json'));delta=set(source['changedParentFiles'])|set(source['newFiles']);assert len(delta)==10
with tarfile.open(pre['tar'],'r:gz')as full,tarfile.open(source['tar'],'r:gz')as changed:
 for name,digest in source['files'].items():
  assert h((repo/name).read_bytes())==digest
  content=(changed if name in delta else full).extractfile(name).read();assert h(content)==digest
 assert all(h(full.extractfile(name).read())==digest for name,digest in pre['files'].items())
d=json.loads((base/'验收/用例覆盖索引.json').read_text());before=json.load(open('/private/tmp/willyou-dev156-cases-before.json'));actual=[]
for old,new in zip(before['cases'],d['cases']):
 assert old['id']==new['id']
 if old!=new:actual.append(new['id'])
 for field in ['requirements','environments','steps','expected','scope','level','source']:assert old[field]==new[field]
assert actual==['M9-T-J09'];cur=[x for x in d['cases']if x['scope']!='future-remote'];assert len(d['cases'])==425 and len(cur)==419;counts={s:sum(x['status']==s for x in cur)for s in ['通过','未执行','阻塞']};assert counts=={'通过':264,'未执行':152,'阻塞':3}
tests=json.load(open('/private/tmp/willyou-dev156-code-r93-green.json'));ids=[s['name']+'::'+a['fullName']for s in tests['testResults']for a in s['assertionResults']];assert len(ids)==len(set(ids))==71;assert tests['numFailedTests']==tests['numPendingTests']==0
native=json.load(open('/private/tmp/willyou-dev156-native-r93-final-I.json'));assert len(native['rows'])==5 and all(x['pass']for x in native['rows']);v8=json.load(open('/private/tmp/willyou-dev156-v8-audit.json'));assert v8['status']=='passed'and v8['originalV8Payloads']==104
pack=json.load(open('/private/tmp/willyou-dev156-r93-fast-package-result.json'));assert pack['status']=='passed';process=json.load(open('/private/tmp/willyou-dev156-process-audit.json'));assert len(process['runs'])==3 and all(x['pidAbsent']and x['ownProfileProjectMatches']==0 for x in process['runs'])
runtime=json.load(open('/private/tmp/willyou-dev156-runtime-r93.log'));assert len(runtime['files'])==82
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','reportSha256':h(p.read_bytes()),'artifactHashesVerified':len(r['artifacts']),'recoveryInputsVerified':len(source['files']),'deltaFiles':len(delta),'onlyChangedCase':actual,'currentTotal':419,'counts':counts,'percentage':round(264/419*100,2),'distinctCodeTests':len(ids),'nativeRefreshScenarios':5,'appChecks':10,'originalV8PayloadsVerified':104,'ownedAppRunsGone':3,'runtimeFilesVerified':82,'boundary':'Report104 artifacts remain immutable. This audit and documentation writer are supplementary files, not counted among those104. No source production/native/build changes after r93. Goal stays active; incomplete cases remain.'}
out=base/'验收/证据/acceptance-xlsx-refresh-dev156-r93-final'
for path in ['/private/tmp/willyou-dev156-docs.py','/private/tmp/willyou-dev156-final-audit.py']:shutil.copy2(path,out/Path(path).name)
Path('/private/tmp/willyou-dev156-final-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');shutil.copy2('/private/tmp/willyou-dev156-final-audit.json',out/'willyou-dev156-final-audit.json');print(json.dumps(result,ensure_ascii=False))
