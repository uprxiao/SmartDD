from binding_guard import assert_bound
assert_bound()
from pathlib import Path
import json,hashlib,subprocess,datetime,os,sys
root=Path(__file__).parent
assert os.environ.get('WILLYOU_P127_ROOT_LEASE')=='Root-App031-exclusive'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
ready=root/'execution-ready.json';assert sha(ready)=='0485dd1b32a467b60c0b230aa1182c6662ae4def6fbb89899c6cc4e4a8252e98'
d=json.loads(ready.read_text());prepared=Path(d['preparedInputs']['path']);assert sha(prepared)==d['preparedInputs']['sha256']
# File-only admission for original mkdir-requires-absent destinations, no OS probe.
for rel in json.loads((root/'directory-shape.json').read_text())['requiredAbsent']:
 p=root/rel;assert not p.exists() and not p.is_symlink(), 'Original execution-only destination must be absent: '+str(p)
for f in json.loads(prepared.read_text())['inputs']:
 p=Path(f['path']);assert sha(p)==f['sha256'],p
state={'scope':'Root actual existing P127 phases01-06 only; no source rebuild/publish/model; stop on first failure. Startup07 requires separate Root current-pin review.','driverPid':os.getpid(),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'phases':[],'status':'running'}
def save(): (root/'first-six-state.json').write_text(json.dumps(state,indent=2)+'\n')
save()
for item in d['commandsSequential'][:6]:
 row={'id':item['id'],'command':item['shell'],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};state['phases'].append(row);save()
 out=root/(item['id']+'.stdout.log');err=root/(item['id']+'.stderr.log')
 with out.open('wb')as so,err.open('wb')as se:
  child=subprocess.Popen(['/bin/zsh','-lc',item['shell']],cwd='/Users/liubu/hx/4.uprxiao/SmartDD',env=os.environ.copy(),stdout=so,stderr=se);row['pid']=child.pid;save();print(json.dumps({'phase':item['id'],'pid':child.pid}),flush=True);code=child.wait()
 row.update(exitCode=code,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),stdout=str(out),stderr=str(err));save();print(json.dumps({'phase':item['id'],'exitCode':code}),flush=True)
 if code:
  state.update(status='failed-stop-before-dependent-phases',finishedAt=row['finishedAt']);save();sys.exit(code)
state.update(status='first-six-complete-pending-Root-startup-pin-review',finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());save();print(state['status'],flush=True)
