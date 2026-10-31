"""Hash review and immutable archive only. No case status, App, or process action."""
from pathlib import Path
import argparse,datetime,hashlib,json,re,shutil
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--group',required=True);p.add_argument('--attempt',required=True);p.add_argument('--sha',required=True);a=p.parse_args();assert re.fullmatch(r'M9-G\d{3}',a.group) and re.fullmatch(r'\d{3}',a.attempt) and re.fullmatch(r'[0-9a-f]{64}',a.sha)
root=Path('/Users/liubu/Documents/ChatGPT/SmartDD');acc=root/'docs/里程碑/M9_文件浏览工作区/验收';run='M9-20261021T005835Z-9de5-12b28f';src=Path(a.source);dst=acc/'证据/并行测试'/run/a.group/('attempt-'+a.attempt);h=lambda f:hashlib.sha256(f.read_bytes()).hexdigest();assert h(src/'manifest.json')==a.sha;m=json.loads((src/'manifest.json').read_text());payload=m.get('payload',m.get('files'));assert isinstance(payload,list);counts={}
for key,rows in m.items():
 if not isinstance(rows,list):continue
 seen=0
 for row in rows:
  if not isinstance(row,dict) or 'sha256' not in row:continue
  assert 'bytes' in row and ('path' in row or 'relativePath' in row),(key,row.keys())
  f=Path(row.get('path',row.get('relativePath')));f=f if f.is_absolute() else src/f;assert f.is_file() and f.stat().st_size==row['bytes'] and h(f)==row['sha256'],str(f);seen+=1
 if seen:counts[key]=seen
for row in payload:
 rel=Path(row.get('path',row.get('relativePath')));assert not rel.is_absolute() and '..' not in rel.parts and str(rel)!='manifest.json'
rp=acc/'并行测试/轮次'/run/'轮次记录.json';r=json.loads(rp.read_text());old=[x for x in r['deliveries'] if x.get('groupId')==a.group and x.get('attempt')==a.attempt]
if dst.exists():
 assert h(dst/'manifest.json')==a.sha
 for row in payload:
  f=dst/row.get('path',row.get('relativePath'));assert f.is_file() and h(f)==row['sha256'],str(f)
 assert len(old)==1 and old[0]['deliverySHA256']==a.sha;print(json.dumps({'archive':str(dst),'alreadyArchived':True,'counts':counts,'formalCaseIncrement':0},ensure_ascii=False));raise SystemExit(0)
assert not old;dst.mkdir(parents=True)
for row in payload:
 rel=Path(row.get('path',row.get('relativePath')));assert not rel.is_absolute() and '..' not in rel.parts;out=dst/rel;out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src/rel,out);assert h(out)==row['sha256']
shutil.copy2(src/'manifest.json',dst/'manifest.json');now=datetime.datetime.now(datetime.timezone.utc).isoformat();r['updatedAt']=now;r['deliveries'].append({'at':now,'groupId':a.group,'attempt':a.attempt,'deliverySHA256':a.sha,'payloadVerified':len(payload),'inputsVerified':sum(n for k,n in counts.items() if k not in ['payload','files']),'archive':str(dst.relative_to(root)),'formalCaseIncrement':0});rp.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'archive':str(dst),'alreadyArchived':False,'counts':counts,'formalCaseIncrement':0},ensure_ascii=False))
