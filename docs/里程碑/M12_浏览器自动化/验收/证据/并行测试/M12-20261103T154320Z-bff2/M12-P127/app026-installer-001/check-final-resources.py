from binding_guard import assert_bound
assert_bound(verify_inputs=False)
from pathlib import Path
import subprocess,json,plistlib,os,datetime
root=Path(__file__).parent;state=json.loads((root/'first-six-state.json').read_text());start=json.loads((root/'evidence/attempt-002/installer-build-start.json').read_text());pids=sorted(set([state['driverPid'],start['builderPid'],*[x['pid'] for x in state['phases']]]));checks=[]
for pid in pids:
 p=subprocess.run(['/bin/ps','-p',str(pid),'-o','pid=,lstart=,comm='],capture_output=True,text=True);checks.append({'pid':pid,'absent':p.returncode==1 and not p.stdout.strip()})
info=plistlib.loads(subprocess.check_output(['/usr/bin/hdiutil','info','-plist']));mounts=[str(x.get('image-path')) for x in info.get('images',[]) if str(root) in str(x.get('image-path',''))]
installed=str(root/'Installed Applications/WillYou.app/Contents/');rows=subprocess.check_output(['/bin/ps','-ww','-axo','pid=,command='],text=True).splitlines();active=[x for x in rows if installed in x and int(x.strip().split()[0])!=os.getpid()];out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'completedWrapperAndPhasePidAbsence':checks,'ownedMountsRemaining':mounts,'installedAppProcessPrefixCount':len(active),'allClear':all(x['absent'] for x in checks) and not mounts and not active,'boundary':'Only recorded own wrapper/phase PIDs, exact current-private-image paths and exact installedApp prefix; no kills or daily-data reads.'};(root/'coordinator-resource-release.json').write_text(json.dumps(out,indent=2)+'\n');assert out['allClear'],out;print(json.dumps({'allClear':True,'phasePids':len(checks),'ownMounts':len(mounts),'installedAppProcesses':len(active)}))
