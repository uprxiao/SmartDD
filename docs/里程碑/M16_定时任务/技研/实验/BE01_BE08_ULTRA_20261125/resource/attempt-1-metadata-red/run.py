#!/usr/bin/env python3
"""Launch and observe exact isolated child, no user App data or focus."""
from pathlib import Path
import hashlib, json, os, subprocess, sys, time, datetime
root=Path(__file__).resolve().parent
assert str(root).startswith('/private/tmp/willyou-f36-ultra-')
source=Path('/private/tmp/willyou-f36-lab-tljocnfp/candidate')
electron=source/'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
assert electron.is_file() and os.access(electron,os.X_OK)
for name in ('home','tmp','xdg-config','xdg-cache','xdg-data'): (root/name).mkdir(mode=0o700,exist_ok=True)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def group_members(pgid):
 q=subprocess.run(['/bin/ps','-axo','pid=,pgid='],capture_output=True,text=True,timeout=4,check=True)
 return sorted(int(f[0]) for row in q.stdout.splitlines() if len(f:=row.split())==2 and f[1].isdigit() and int(f[1])==pgid)
env=dict(PATH='/usr/bin:/bin:/usr/sbin:/sbin',LANG='en_US.UTF-8',HOME=str(root/'home'),TMPDIR=str(root/'tmp'),XDG_CONFIG_HOME=str(root/'xdg-config'),XDG_CACHE_HOME=str(root/'xdg-cache'),XDG_DATA_HOME=str(root/'xdg-data'),F36_ULTRA_ROOT=str(root))
cmd=[str(electron),str(root/'probe.cjs')]
inputs=['probe.ts','probe.cjs','fixture.html','run.py']
source_files=['src/main/core/browser/page-registry.ts','src/main/core/browser/park-window.ts','src/main/core/browser/references.ts','src/main/core/browser/queue.ts','src/main/core/browser/agent-browser.ts','out/agent-browser/SOURCE.json','out/agent-browser/arm64/agent-browser','out/native/willyou-process-identity']
manifest=dict(kind='F36 Ultra local isolated registry experiment',created=now(),root=str(root),source=str(source),command=cmd,sourceHashes={f:sha(source/f) for f in source_files},electronHash=sha(electron),inputHashes={f:sha(root/f) for f in inputs},isolatedEnvironment=True,noRemoteSites=True)
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
launch=dict(start=now(),forcedTermination=[],timedOut=False)
with (root/'stdout.log').open('wb') as out,(root/'stderr.log').open('wb') as err:
 child=subprocess.Popen(cmd,cwd=root,env=env,stdout=out,stderr=err,start_new_session=True)
 launch.update(pid=child.pid,processGroup=child.pid)
 (root/'launch.json').write_text(json.dumps(launch,indent=2)+'\n')
 try: launch['exitCode']=child.wait(timeout=240)
 except (KeyboardInterrupt,subprocess.TimeoutExpired) as e:
  launch['timedOut']=isinstance(e,subprocess.TimeoutExpired);launch['forcedTermination'].append('terminate exact launched child')
  child.terminate()
  try:launch['exitCode']=child.wait(timeout=15)
  except subprocess.TimeoutExpired:
   launch['forcedTermination'].append('kill exact launched child');child.kill();launch['exitCode']=child.wait(timeout=10)
end=time.monotonic()+8
while True:
 launch['processGroupMembersAfterExit']=group_members(launch['processGroup'])
 if not launch['processGroupMembersAfterExit'] or time.monotonic()>=end:break
 time.sleep(.2)
launch['finished']=now();(root/'launch.json').write_text(json.dumps(launch,indent=2)+'\n')
print(json.dumps(dict(root=str(root),**launch)),flush=True)
raise SystemExit(launch['exitCode']!=0 or bool(launch['processGroupMembersAfterExit']))
