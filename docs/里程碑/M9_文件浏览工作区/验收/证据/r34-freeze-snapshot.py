from pathlib import Path
from datetime import datetime
import hashlib,json,zipfile,subprocess
root=Path(__file__).resolve().parents[5]; st=root/'docs/里程碑/M9_文件浏览工作区'; snap=st/'原型/快照'; proto=root/'prototypes/m6-codex'
sha=lambda data: hashlib.sha256(data).hexdigest()
base=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
created=datetime.now().astimezone().isoformat()
production=[root/p for p in ['src/main/pty-access.ts','src/main/pty-access.test.ts','src/main/app/window.test.ts','src/main/app/window.ts','src/main/core/tasks/controller.ts','src/main/core/tasks/task-service.ts','src/main/core/tasks/task-service.test.ts','src/main/index.ts','src/main/rpc.ts','src/renderer/views/task-view.tsx','src/shared/events.ts']]
oldp=json.loads((snap/'manifest-r3.3.json').read_text())
protopaths=[proto/f['path'] for f in oldp['files']]
for folder in ['src','tests','fixtures','scripts','public','worker']:
 protopaths.extend(p for p in (proto/folder).rglob('*') if p.is_file() and p.name!='.DS_Store' and '__pycache__' not in p.parts)
oldd=json.loads((snap/'manifest-r3.3-documents.json').read_text())
docpaths=[root/f['path'] for f in oldd['files']]
docpaths.extend(p for p in st.rglob('*.md') if snap not in p.parents)
docpaths.extend([st/'验收/用例覆盖索引.json',st/'验收/维护用例索引.py',root/'AGENTS.md',root/'CLAUDE.md',root/'docs/需求池.md',root/'docs/里程碑/README.md'])
evidence=[]
for folder in ['技研/实验','验收/证据']:
 evidence.extend(p for p in (st/folder).rglob('*') if p.is_file() and p.suffix!='.md' and p.name!='.DS_Store' and '__pycache__' not in p.parts)
# No dependency directories, builds, downloaded binaries or private REA payloads.
groups=[('prototype',proto,protopaths,'m6-codex/'),('documents',root,docpaths,''),('implementation',root,production,''),('evidence',root,evidence,'')]
for label,pathroot,paths,prefix in groups:
 paths=sorted(set(paths)); archive=snap/f'M9-R3.4-20261017-{label}.zip'; mpath=snap/f'manifest-r3.4-{label}.json'
 if archive.exists() or mpath.exists(): raise SystemExit(f'Refusing to overwrite frozen snapshot: {archive}')
 manifest={'schema':'smartdd-m9-r34-snapshot-v1','kind':label,'milestone':'M9','revision':'R3.4-20261017','status':'authorized-nine-gap-remediation-partial-delivery-not-full-m9-acceptance','base_commit':base,'branch':'feature/0.0.1','created_at':created,'archive':archive.name,'restore_boundary':'Restore to a temporary directory first. Verify hashes. Current shared worktree contains other agents/user changes; do not overwrite blindly. No node_modules/build/private reference bundle/user data included.','files':[]}
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
  for p in paths:
   if not p.exists():raise SystemExit(f'Missing {p}')
   rel=str(p.relative_to(pathroot)); data=p.read_bytes(); z.writestr(prefix+rel,data);manifest['files'].append({'path':rel,'archive_path':prefix+rel,'bytes':len(data),'sha256':sha(data)})
 manifest.update(file_count=len(paths),archive_bytes=archive.stat().st_size,archive_sha256=sha(archive.read_bytes()))
 mpath.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'kind':label,**{k:manifest[k] for k in ['file_count','archive','archive_bytes','archive_sha256']}},ensure_ascii=False))
