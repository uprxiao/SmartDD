from pathlib import Path
import datetime,gzip,hashlib,io,json,os,subprocess,tarfile
root=Path('/Users/hx/hx/hxWork/SmartDD')
previous_path=Path('/private/tmp/willyou-m9-acceptance-batch-r21-sources.json')
previous=json.loads(previous_path.read_text())
files=set(previous['files'])
files.update(subprocess.check_output(['rg','--files','src','native','scripts'],cwd=root,text=True).splitlines())
files.add('vitest.config.ts')
files.update(['prototypes/m6-codex/tests/notebook-header-runtime.html','prototypes/m6-codex/tests/notebook-header-harness.jsx'])
files.update(['prototypes/m6-codex/src/file-attachment-presentation.mjs','prototypes/m6-codex/tests/file-attachment-presentation.test.mjs'])
files.add('prototypes/m6-codex/tests/file-pdf-reading.test.mjs')
prefix=Path('/private/tmp/willyou-m9-acceptance-batch-r21-final-tested-sources')
archive=prefix.with_suffix('.tar.gz')
manifest=prefix.with_suffix('.json')
if archive.exists() or manifest.exists():
 raise SystemExit('Refusing to replace an existing acceptance-batch source baseline')
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
sha=lambda data:hashlib.sha256(data).hexdigest()
hashes={};metadata={}
with archive.open('xb') as raw:
 with gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0) as compressed:
  with tarfile.open(fileobj=compressed,mode='w|',format=tarfile.PAX_FORMAT) as tar:
   for relative in sorted(files):
    p=root/relative
    if not p.is_file() or p.is_symlink():raise RuntimeError('Invalid source path '+relative)
    data=p.read_bytes();s=p.stat();hashes[relative]=sha(data)
    info=tarfile.TarInfo(relative);info.size=len(data);info.mode=s.st_mode&0o777;info.mtime=int(s.st_mtime)
    tar.addfile(info,io.BytesIO(data))
changed=[relative for relative,h in hashes.items() if sha((root/relative).read_bytes())!=h]
if changed:raise RuntimeError('Sources changed during snapshot: '+', '.join(changed))
result={'path':str(archive),'sha256':sha(archive.read_bytes()),'files':hashes,'createdAt':started,'branch':subprocess.check_output(['git','branch','--show-current'],cwd=root,text=True).strip(),'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),'previousManifest':str(previous_path),'addedFiles':sorted(files-set(previous['files'])),'changedFromPrevious':sorted(p for p in files&set(previous['files']) if hashes[p]!=previous['files'][p]),'fileCount':len(files)}
manifest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='files'},ensure_ascii=False,indent=2))
