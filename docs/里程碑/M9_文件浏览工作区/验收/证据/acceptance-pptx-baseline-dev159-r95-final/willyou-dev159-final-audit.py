from pathlib import Path
import gzip,hashlib,json,shutil,datetime
root=Path.cwd();base=root/'docs/里程碑/M9_文件浏览工作区';rp=base/'验收/证据/m9-acceptance-pptx-baseline-dev159-r95-20261020.json';h=lambda b:hashlib.sha256(b).hexdigest();assert h(rp.read_bytes())=='626cee017f316dda165e6c9297191f2c762d38aece33cadaa5b9acb46807b3a4';r=json.loads(rp.read_text())
for x in r['artifacts'].values():
 b=(root/x['path']).read_bytes();assert len(b)==x['bytes']and h(b)==x['sha256']
 if x.get('compression')=='gzip':b=gzip.decompress(b);assert len(b)==x['originalBytes']and h(b)==x['originalSha256']
source=json.load(open('/private/tmp/willyou-dev158-source-delta.json'));assert len(source['files'])==1340 and all(h((root/p).read_bytes())==v for p,v in source['files'].items());before=json.load(open('/private/tmp/willyou-dev158-cases-before.json'));after=json.loads((base/'验收/用例覆盖索引.json').read_text());status=[]
for a,b in zip(before['cases'],after['cases']):
 assert a['id']==b['id']
 for k in a:
  if k not in {'status','evidence','actual_result','defects','prototype_status','prototype_note'}:assert a[k]==b[k]
 if a['status']!=b['status']:status.append(b['id'])
assert status==['M9-T-J02'];cur=[c for c in after['cases']if c['scope']!='future-remote'];counts={s:sum(c['status']==s for c in cur)for s in ['通过','未执行','阻塞']};assert counts=={'通过':266,'未执行':150,'阻塞':3};audit=json.load(open('/private/tmp/willyou-dev159-v8-audit.json'));assert audit['status']=='passed'and len(audit['positiveChecks'])==2 and len(audit['negativeChecks'])==4;result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','reportSha256':h(rp.read_bytes()),'artifactHashesVerified':len(r['artifacts']),'engineeringInputsUnchanged':1340,'statusAdvancesSinceDEV158Start':status,'formalCounts':counts,'percentage':round(266/419*100,2),'originalV8PayloadsChecked':266,'boundary':'Original scope/steps/expected/env fields unchanged. Main30 artifacts immutable, docs+this audit supplementary. W28 still unexecuted while XLSX16 running; no stage completion/release.'};out=base/'验收/证据/acceptance-pptx-baseline-dev159-r95-final';p=Path('/private/tmp/willyou-dev159-final-audit.json');p.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for f in [p,Path(__file__),Path('/private/tmp/willyou-dev159-docs.py')]:shutil.copy2(f,out/f.name)
print(json.dumps(result,ensure_ascii=False))
