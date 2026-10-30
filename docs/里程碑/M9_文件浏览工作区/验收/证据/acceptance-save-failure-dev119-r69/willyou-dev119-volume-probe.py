from pathlib import Path
import datetime,errno,json,os,plistlib,subprocess,tempfile
base=Path(tempfile.mkdtemp(prefix='willyou-h09-volume-probe-',dir='/private/tmp'));image=base/'disk.dmg';mount=base/'volume';mount.mkdir()
r={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scratch':str(base),'status':'running','boundary':'Disposable16MiB own disk image, mounted only at own /private/tmp path; never fill the host filesystem. Native ENOSPC feasibility only, not App acceptance.'};device=None
def run(args):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=45);r.setdefault('commands',[]).append({'args':args,'code':p.returncode,'stderr':p.stderr.decode(errors='replace')});p.check_returncode();return p.stdout
try:
 run(['hdiutil','create','-size','16m','-fs','HFS+','-volname','WillYou-H09-Probe','-type','UDIF',str(image)])
 raw=run(['hdiutil','attach','-nobrowse','-noautoopen','-mountpoint',str(mount),'-plist',str(image)])
 (base/'attach.plist').write_bytes(raw);entities=plistlib.loads(raw)['system-entities'];r['entities']=entities;device=next(e['dev-entry'] for e in entities if e.get('mount-point')==str(mount))
 assert os.path.ismount(mount) and mount.stat().st_dev!=base.stat().st_dev
 fs=os.statvfs(mount);assert fs.f_blocks*fs.f_frsize<=32*1024*1024;r['capacityBytes']=fs.f_blocks*fs.f_frsize
 filler=mount/'filler';written=0
 with filler.open('wb',buffering=0) as out:
  try:
   while True:written+=out.write(b'x'*4096)
  except OSError as error:assert error.errno==errno.ENOSPC;r['actualErrno']=error.errno;r['actualError']=str(error)
 r['writtenBytes']=written;assert written<32*1024*1024
 filler.unlink();(mount/'retry.txt').write_text('Retry after actual ENOSPC\n');assert (mount/'retry.txt').read_text()=='Retry after actual ENOSPC\n';r['retrySucceeded']=True;r['status']='passed-feasibility-only'
except Exception as error:r['status']='failed';r['error']=repr(error)
finally:
 if device:
  try:run(['hdiutil','detach',device]);r['detached']=True
  except Exception as error:r['detachError']=repr(error)
 r['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(base/'result.json').write_text(json.dumps(r,indent=2)+'\n');Path('/private/tmp/willyou-dev119-volume-probe.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
