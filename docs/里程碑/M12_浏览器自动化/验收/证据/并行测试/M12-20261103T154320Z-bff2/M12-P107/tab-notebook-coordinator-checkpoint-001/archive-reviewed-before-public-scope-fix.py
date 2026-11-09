from pathlib import Path
import json,hashlib,shutil,os,datetime,sys
src=Path(sys.argv[1]);base=Path('docs/里程碑/M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2').resolve();dest=base/sys.argv[2];scope=sys.argv[3];dest.mkdir(parents=True,exist_ok=False);idx={};sha=lambda b:hashlib.sha256(b).hexdigest()
for m in base.rglob('manifest.json'):
 try:d=json.loads(m.read_text())
 except Exception:continue
 for f in d.get('files',[]):
  if isinstance(f,dict)and f.get('path')and f.get('sha256'):
   p=m.parent/f['path']
   if p.is_file():idx.setdefault(f['sha256'],p)
mb=(src/(sys.argv[5] if len(sys.argv)>5 else 'manifest.json')).read_bytes();d=json.loads(mb);files=[];reuse=[];private=[]
for f in d['files']:
 p=src/f['path'];b=p.read_bytes();assert sha(b)==f['sha256']
 if len(sys.argv)>4 and f['path'].startswith(sys.argv[4]):private.append(f);continue
 r=idx.get(f['sha256'])
 if r and sha(r.read_bytes())==f['sha256']:reuse.append({**f,'publicPath':os.path.relpath(r,dest)})
 else:
  target='archived-input-manifest.json' if f['path']=='manifest.json' else f['path'];q=dest/target;q.parent.mkdir(parents=True,exist_ok=True);q.write_bytes(b);files.append({**f,'path':target,**({'sourcePath':f['path']} if target!=f['path'] else {}),'bytes':len(b)});idx[f['sha256']]=q
(dest/'private-original-manifest.json').write_bytes(mb);files.append({'path':'private-original-manifest.json','bytes':len(mb),'sha256':sha(mb)})
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':scope,'privateOriginalManifestSha256':sha(mb),'files':files,'reusedPublicFiles':reuse,'verifiedPrivateDependenciesNotArchived':private};(dest/'manifest.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(sys.argv[2],'new',len(files),'reuse',len(reuse),'SHA',sha((dest/'manifest.json').read_bytes()))
