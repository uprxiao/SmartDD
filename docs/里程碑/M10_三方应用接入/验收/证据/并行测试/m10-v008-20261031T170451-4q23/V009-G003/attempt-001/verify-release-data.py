from pathlib import Path
import json,hashlib,re,datetime,time,os,stat,platform
BASE=Path('/private/tmp/willyou-v008-integration-4q23427h/evidence/V009-G003/attempt-001')
INPUT=Path('/private/tmp/willyou-v008-integration-4q23427h/evidence/v009-public-assets-frozen-inputs.json')
ROOT=Path('/private/tmp/willyou-m10-v009-downloads-601aa58648604b3e825c596143583282')
EXPECTED_INPUT='d7903e097f6b63bef40412ee090f7024e7a0f9601ddaddc52ac7d9b33e5329f6'
COMMIT='a6bfc60873a0c68e8ac630e2c9b951db04db82c8'
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
start=now();started=time.monotonic();checks=[];failures=[]
def save(name,data):(BASE/name).write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')
def check(name,condition,detail=None):
 r={'name':name,'passed':bool(condition),'detail':detail};checks.append(r)
 if not condition:failures.append(r)
 print(json.dumps(r,ensure_ascii=False),flush=True)
 return bool(condition)
def read_json_no_duplicates(data):
 def hook(pairs):
  result={}
  for key,value in pairs:
   if key in result:raise ValueError('Duplicate JSON key: '+key)
   result[key]=value
  return result
 return json.loads(data,object_pairs_hook=hook)
def state(p):
 s=p.lstat();return {'path':str(p),'bytes':s.st_size,'mode':stat.S_IMODE(s.st_mode),'mtimeNs':s.st_mtime_ns,'regular':stat.S_ISREG(s.st_mode),'symlink':stat.S_ISLNK(s.st_mode)}
input_bytes=INPUT.read_bytes();check('Frozen input manifest SHA256',hashlib.sha256(input_bytes).hexdigest()==EXPECTED_INPUT)
m=read_json_no_duplicates(input_bytes);local=read_json_no_duplicates((BASE/'local-hashes.json').read_bytes());before=read_json_no_duplicates((BASE/'frozen-before.json').read_bytes())
local_map={x['name']:x for x in local['files']};input_map={x['name']:x for x in m['files']}
check('Streaming local SHA audit completed once',local['status']=='passed' and local['totalFiles']==12 and local['totalBytes']==1889643464)
raw_api={};api={}
for key in ['sourceApi','actionsApi']:
 data=Path(m[key]['path']).read_bytes();h=hashlib.sha256(data).hexdigest();check(key+' frozen SHA256',h==m[key]['sha256'],{'sha256':h,'path':m[key]['path']});raw_api[key]=data;api[key]=read_json_no_duplicates(data)
release=api['sourceApi'];actions=api['actionsApi'];assets=release['assets'];asset_map={a['name']:a for a in assets}
check('Release tag/prerelease/draft',release['tag_name']=='v0.0.9' and release['prerelease'] is True and release['draft'] is False,{'tag':release['tag_name'],'prerelease':release['prerelease'],'draft':release['draft']})
check('Release exact 12 unique uploaded assets',len(assets)==12 and len(asset_map)==12 and len({a['id'] for a in assets})==12 and all(a['state']=='uploaded' for a in assets),{'count':len(assets)})
check('Release assets exactly match frozen downloads',set(asset_map)==set(local_map)==set(input_map),{'assetNames':sorted(asset_map)})
file_results=[]
for name,actual in sorted(local_map.items()):
 a=asset_map[name];f=input_map[name]
 ok=actual['bytes']==a['size']==f['bytes'] and 'sha256:'+actual['sha256']==a['digest']==f['expectedGitHubDigest']
 check('Local SHA256/size matches original GitHub asset: '+name,ok)
 file_results.append({'name':name,'path':actual['path'],'bytes':actual['bytes'],'sha256':actual['sha256'],'matchesGitHub':ok,'assetId':a['id'],'assetApiUrl':a['url'],'downloadUrl':a['browser_download_url'],'sourceDigest':a['digest'],'sourceSize':a['size'],'sourceState':a['state']})
expected={
 ('mac','arm64'):['WillYou-0.0.9-mac-arm64.dmg'],
 ('mac','x64'):['WillYou-0.0.9-mac-x64.dmg'],
 ('win','x64'):['WillYou-0.0.9-win-x64.exe','WillYou-0.0.9-win-x64.msi'],
 ('linux','x64'):['WillYou-0.0.9-linux-x86_64.AppImage','WillYou-0.0.9-linux-amd64.deb','WillYou-0.0.9-linux-x86_64.rpm'],
}
installer_set={x for names in expected.values() for x in names};manifest_names={'manifest-'+p+'-'+a+'.json' for p,a in expected}
check('Exact published 7 installer / 4 producer / 1 sums inventory',set(local_map)==installer_set|manifest_names|{'SHA256SUMS.txt'})
sum_bytes=(ROOT/'SHA256SUMS.txt').read_bytes();lines=sum_bytes.decode('utf-8').splitlines();sum_pairs=[];invalid=[]
for i,line in enumerate(lines,1):
 match=re.fullmatch(r'([0-9a-f]{64})  ([^/\\\x00\r\n]+)',line)
 if not match:invalid.append({'line':i,'text':line})
 else:sum_pairs.append((match.group(2),match.group(1)))
sums=dict(sum_pairs)
check('SHA256SUMS has exactly 7 unique valid installer rows',not invalid and len(lines)==7 and len(sum_pairs)==7 and len(sums)==7,{'rowCount':len(lines),'invalidRows':invalid})
check('SHA256SUMS exact installer set with no extra/missing entries',set(sums)==installer_set,{'missing':sorted(installer_set-set(sums)),'extra':sorted(set(sums)-installer_set)})
sum_results=[]
for name in sorted(installer_set):
 ok=sums.get(name)==local_map[name]['sha256'];check('Installer checksum matches actual SHA256: '+name,ok);sum_results.append({'name':name,'sha256':sums.get(name),'actualSha256':local_map[name]['sha256'],'passed':ok})
correction={'schema':'v009-g003-task-scope-correction-v1','initialRequestedChecksumCoverage':11,'actualInitialChecksumRows':7,'initialAbsentManifestRows':sorted(manifest_names),'classification':'Coordinator task description error; corrected before final conclusion, not a product or download failure','correctedChecksumCoverage':7,'coordinatorRationale':'Original scripts/release/artifacts.mjs accumulates sums only inside installer loop; four producer manifests join files, not sums (coordinator cites lines 56-58). verifyArtifacts.files count 11 and SHA256SUMS installer row count 7 are distinct.','sourceRationaleBoundary':'Provided by coordinator in current task steering; this independent audit does not read or execute production verifier source','originalInputUnmodified':True,'noStreamingHashRerun':True,'otherCriteriaUnchanged':True}
save('task-scope-correction.json',correction)
producer_results=[];covered=[]
for (p,a),filenames in expected.items():
 name='manifest-'+p+'-'+a+'.json';data=(ROOT/name).read_bytes();producer=read_json_no_duplicates(data)
 check('Producer schema/version/commit/clean unsigned metadata: '+name,type(producer.get('schemaVersion')) is int and producer['schemaVersion']==2 and producer.get('version')=='0.0.9' and producer.get('commit')==COMMIT and producer.get('dirty') is False and producer.get('signed') is False and (producer.get('platform'),producer.get('arch'))==(p,a))
 check('Producer original verification label retained: '+name,producer.get('verification')=='packaged-electron-sqlite-pty',{'verification':producer.get('verification'),'interpretation':'Original producer label only; no new business/native acceptance claimed'})
 entries=producer['files'];names=[f['file'] for f in entries]
 check('Producer exact installer allocation: '+name,len(names)==len(filenames) and len(set(names))==len(names) and set(names)==set(filenames),{'expected':filenames,'actual':names})
 for f in entries:
  actual=local_map.get(f.get('file'));ok=actual is not None and type(f.get('size')) is int and f['size']==actual['bytes'] and f.get('sha256')==actual['sha256'];check('Producer installer bytes/SHA256: '+f['file'],ok);covered.append(f['file'])
 producer_results.append({'file':name,'schemaVersion':producer['schemaVersion'],'version':producer['version'],'commit':producer['commit'],'platform':p,'arch':a,'signed':producer['signed'],'dirty':producer['dirty'],'verification':producer['verification'],'files':entries,'sourceAssetId':asset_map[name]['id'],'sourceAssetDigest':asset_map[name]['digest'],'actualSha256':local_map[name]['sha256']})
check('Four producers cover seven installers exactly once',len(producer_results)==4 and len(covered)==7 and len(set(covered))==7 and set(covered)==installer_set)
check('Actions run completed successfully at exact a6b commit',actions['headSha']==COMMIT and actions['conclusion']=='success' and actions['status']=='completed',{'headSha':actions['headSha'],'status':actions['status'],'conclusion':actions['conclusion'],'url':actions['url']})
jobs=actions['jobs'];check('Actions exactly 9 unique completed successful jobs',len(jobs)==9 and len({j['databaseId'] for j in jobs})==9 and len({j['name'] for j in jobs})==9 and all(j['conclusion']=='success' and j['status']=='completed' for j in jobs),{'count':len(jobs)})
job_results=[{'id':j['databaseId'],'name':j['name'],'status':j['status'],'conclusion':j['conclusion'],'url':j['url'],'startedAt':j['startedAt'],'completedAt':j['completedAt']} for j in jobs]
for j in job_results:check('Original Actions job success: '+j['name'],j['status']=='completed' and j['conclusion']=='success',j)
after={'at':now(),'inputManifest':state(INPUT),'inputManifestSha256':hashlib.sha256(INPUT.read_bytes()).hexdigest(),'api':{},'files':[state(Path(f['path'])) for f in m['files']]}
for key in ['sourceApi','actionsApi']:
 p=Path(m[key]['path']);after['api'][key]={**state(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
check('Input manifest mode/mtime/bytes/hash unchanged',after['inputManifest']==before['inputManifest'] and after['inputManifestSha256']==before['inputManifestSha256'])
check('All 12 download mode/mtime/bytes unchanged',after['files']==before['files'] and all(s['mode']==0o400 for s in after['files']))
check('Original Release/Actions API mode/mtime/bytes/hash unchanged',after['api']==before['api'])
save('frozen-after.json',after)
for label,data in [('source-input-manifest.json',input_bytes),('source-release-api.json',raw_api['sourceApi']),('source-actions-api.json',raw_api['actionsApi'])]:(BASE/label).write_bytes(data)
text_dir=BASE/'published-data';text_dir.mkdir(exist_ok=True)
for name in sorted(manifest_names|{'SHA256SUMS.txt'}):(text_dir/name).write_bytes((ROOT/name).read_bytes())
source_result={'release':{'id':release['id'],'apiUrl':release['url'],'htmlUrl':release['html_url'],'tag':release['tag_name'],'targetCommitish':release['target_commitish'],'prerelease':release['prerelease'],'draft':release['draft'],'publishedAt':release['published_at'],'uploadedAssets':len(assets),'apiSha256':m['sourceApi']['sha256']},'actions':{'runId':int(actions['url'].rstrip('/').split('/')[-1]),'url':actions['url'],'headSha':actions['headSha'],'status':actions['status'],'conclusion':actions['conclusion'],'jobs':job_results,'apiSha256':m['actionsApi']['sha256']}}
result={'schema':'v009-g003-file-and-source-audit-v1','group':'V009-G003','attempt':'attempt-001','status':'passed' if not failures else 'failed','start':start,'end':now(),'durationSeconds':round(time.monotonic()-started,6),'pid':os.getpid(),'version':'0.0.9','commit':COMMIT,'inputManifestSha256':EXPECTED_INPUT,'summary':{'localFiles':len(file_results),'localFilesPassed':sum(r['matchesGitHub'] for r in file_results),'totalBytes':sum(r['bytes'] for r in file_results),'installerChecksums':len(sum_results),'installerChecksumsPassed':sum(r['passed'] for r in sum_results),'producerManifests':len(producer_results),'installerCount':len(covered),'targetAllocation':{'mac-arm64':1,'mac-x64':1,'win-x64':2,'linux-x64':3},'actionsJobs':len(job_results),'actionsJobsSuccessful':sum(j['conclusion']=='success' for j in job_results),'checks':len(checks),'checksPassed':sum(c['passed'] for c in checks),'checksFailed':len(failures)},'files':file_results,'checksums':sum_results,'producers':producer_results,'sources':source_result,'taskScopeCorrection':correction,'frozenInputsUnchanged':after['files']==before['files'] and after['api']==before['api'] and after['inputManifest']==before['inputManifest'] and after['inputManifestSha256']==before['inputManifestSha256'],'failures':failures,'formalMilestoneCasesAdded':0,'boundary':'Read-only published file/provenance audit. No installers executed, native OS business acceptance inferred, App/UI/build/model/network started, or production/public results changed. All text parsed only as data.'}
save('audit-checks.json',checks);save('audit-result.json',result)
print(json.dumps({'finalStatus':result['status'],'summary':result['summary'],'source':source_result,'frozenInputsUnchanged':result['frozenInputsUnchanged']},ensure_ascii=False),flush=True)
if failures:raise SystemExit(1)
