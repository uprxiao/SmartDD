from binding_guard import assert_bound
assert_bound()
from pathlib import Path
import json,hashlib,subprocess,datetime,os,sys
root=Path(__file__).parent
assert os.environ.get('WILLYOU_P127_ROOT_LEASE')=='Root-App026-exclusive'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
ready=root/'execution-ready.json';assert sha(ready)=='43422a7d8763f759df1a8220ad8ba4ca28362167588967dc4910f8fd9f30ad5a'
d=json.loads(ready.read_text());prepared=Path(d['preparedInputs']['path']);assert sha(prepared)==d['preparedInputs']['sha256']
for f in json.loads(prepared.read_text())['inputs']:
 p=Path(f['path']);assert sha(p)==f['sha256'],p
original=json.loads((root/'first-six-state.json').read_text());assert [x['exitCode'] for x in original['phases']]==[0,0,0,1]
fix=json.loads((root/'phase04-fixture-correction.json').read_text());assert fix['productOrBuildInputsChanged'] is False and fix['independentOwnedMounts']==[]
assert not (root/'Installed Applications').exists()
state={'scope':'Original phase01-03 already completed retained; only original04-06 after removing owned empty fixture directories, sameApp/source/expected. No rebuild or startup07.','driverPid':os.getpid(),'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'phases':[],'status':'running'}
target=root/'continuation04-06-state.json';assert not target.exists()
def save():target.write_text(json.dumps(state,indent=2)+'\n')
save()
for item in d['commandsSequential'][3:6]:
 row={'id':item['id'],'command':item['shell'],'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};state['phases'].append(row);save()
 out=root/(item['id']+'.continuation002.stdout.log');err=root/(item['id']+'.continuation002.stderr.log')
 with out.open('xb')as so,err.open('xb')as se:
  child=subprocess.Popen(['/bin/zsh','-lc',item['shell']],cwd='/Users/liubu/hx/4.uprxiao/SmartDD',env=os.environ.copy(),stdout=so,stderr=se);row['pid']=child.pid;save();print(json.dumps({'phase':item['id'],'pid':child.pid}),flush=True);code=child.wait()
 row.update(exitCode=code,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),stdout=str(out),stderr=str(err));save();print(json.dumps({'phase':item['id'],'exitCode':code}),flush=True)
 if code:
  state.update(status='failed-stop-before-dependent-phases',finishedAt=row['finishedAt']);save();sys.exit(code)
state.update(status='original01-06-complete-with-retained-first04failure-pending-Root-startup-pin-review',finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat());save();print(state['status'],flush=True)
