#!/usr/bin/env python3
"""Rebase moved Markdown links, retaining each pre-change text as a gzip original."""
from pathlib import Path
import gzip,hashlib,json,os,re,tarfile
from urllib.parse import unquote
here=Path(__file__).resolve().parent
repo=next(p for p in here.parents if (p/'src/main/db/schema.ts').exists())
b=repo/'docs/里程碑/M14_统一Agent工作区';tech=b/'技研'
snapshots=json.loads((here/'snapshots.json').read_text())
replacements={ (b/r['source']).resolve():(b/r['snapshot']).resolve() for r in snapshots }
replacements[tech/'研究关闭审计.json']=tech/'历史/研究关闭审计.json'
moved=json.loads((tech/'历史/实验迁移清单.json').read_text())
move_dirs={ (repo/r['from']).resolve():(repo/r['to']).resolve() for r in moved }
reverse={v:k for k,v in replacements.items()}
statepath=here/'results/link-adjustments.json'
state=json.loads(statepath.read_text()) if statepath.exists() else {'files':[]}
already={r['path']:r for r in state['files']}
backup=here/'link-originals.json.gz'
originals=json.loads(gzip.decompress(backup.read_bytes())) if backup.exists() else {}
archive_cache={}
def moved_target(target):
 for old,new in move_dirs.items():
  if target==old or old in target.parents:return new/target.relative_to(old)
 return target

def source_origin(p):
 # After a first rebase, changed documents are already relative to their new path.
 if str(p.relative_to(repo)) in already:return p
 if p in reverse:return reverse[p]
 for old,new in move_dirs.items():
  if new in p.parents:return old/p.relative_to(new)
 return p

def archived_member(p,target):
 # A formerly unpacked file can be a member of the experiment's committed archive.
 for parent in [p.parent,*p.parents]:
  if not parent.name.startswith('2026'):continue
  if parent not in archive_cache:
   members={}
   for archive in sorted(parent.glob('*.tar.gz')):
    with tarfile.open(archive) as tf:
     for member in tf.getmembers():
      if member.isfile():members.setdefault(member.name,archive)
   archive_cache[parent]=members
  try:rel=target.relative_to(parent).as_posix()
  except ValueError:continue
  if rel in archive_cache[parent]:return archive_cache[parent][rel],rel
 return None

current={repo/'AGENTS.md',repo/'docs/需求池.md',repo/'docs/里程碑/README.md',b/'README.md',b/'需求.md',tech/'技术方案.md',tech/'全局设计验证账.md',tech/'兼容验证计划.md',tech/'旧代码清理清单.md',b/'验收/测试用例.md',b/'验收/执行与缺陷记录.md',b/'原型/原型说明与变更.md'}
pattern=re.compile(r'(?<!!)\[([^\]]*)\]\((<[^>]+>|[^\s)]+)\)')
changes=[]
for p in [repo/'AGENTS.md',*(repo/'docs').rglob('*.md')]:
 if not p.is_file():continue
 text=p.read_text();origin=source_origin(p)
 if b not in p.parents and p not in current and p not in {repo/'docs/review/review-20261115-1121.md',repo/'docs/统一Agent工作区优化方案.md',repo/'docs/WillYou_统一任务UI_Provider续聊与多Agent委派迁移调研.md',repo/'docs/review/WillYou_统一任务迁移调研_R0.1_Review_20261114.md'}:continue
 iscurrent=p in current or here in p.parents or p.name=='复跑.md' or p.name=='复跑说明.md'
 def rewrite(m):
  label,url=m[1],m[2];wrapped=url.startswith('<');u=url[1:-1] if wrapped else url
  if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:',u) or u.startswith(('#','/')):return m[0]
  name,sep,anchor=u.partition('#');target=(origin.parent/unquote(name)).resolve()
  target=moved_target(target)
  if target in replacements and (not iscurrent or target.name=='研究关闭审计.json'):
   target=replacements[target]
  try:exists=target.exists()
  except OSError:return m[0]
  if not exists:
   if Path(str(target)+'.gz').exists():target=Path(str(target)+'.gz')
   else:
    match=archived_member(p,target)
    if match:target,member=match;anchor='member='+member;sep='#'
  rel=os.path.relpath(target,p.parent)
  if target.is_dir() and name.endswith('/'):rel+='/'
  new=rel+(sep+anchor if sep else '')
  if new==u:return m[0]
  if ' ' in new:new='<'+new+'>'
  return '['+label+']('+new+')'
 new=pattern.sub(rewrite,text)
 if new!=text:
  key=str(p.relative_to(repo));originals.setdefault(key,text)
  p.write_text(new)
  changes.append({'path':key,'beforeSha256':hashlib.sha256(text.encode()).hexdigest(),'afterSha256':hashlib.sha256(new.encode()).hexdigest()})
  already[key]=changes[-1]
  backup.write_bytes(gzip.compress(json.dumps(originals,ensure_ascii=False).encode(),mtime=0))
  statepath.write_text(json.dumps({'scope':'link targets only; original prose preserved in link-originals.json.gz','files':list(already.values())},ensure_ascii=False,indent=2)+'\n')
backup.write_bytes(gzip.compress(json.dumps(originals,ensure_ascii=False).encode(),mtime=0))
statepath.write_text(json.dumps({'scope':'link targets only; original prose preserved in link-originals.json.gz','files':list(already.values())},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'linksRebasedInDocuments':len(changes),'originalTextsPreserved':len(originals)},ensure_ascii=False))
