import subprocess,json,pathlib
_pre=subprocess.run(['/usr/bin/osascript','-l','JavaScript','/private/tmp/willyou-m12-foreground-observer-001/frontmost.jxa'],capture_output=True,text=True,check=True);_front=json.loads(_pre.stdout);pathlib.Path('/private/tmp/willyou-m12-t131-T07-T14-App031-A-R-prep-005/root-foreground-precheck.json').write_text(json.dumps(_front)+'\n');assert _front.get('pid') and _front.get('name')!='loginwindow', 'Desktop unavailable; do not start App'
from pathlib import Path
import subprocess,json,datetime,os,signal
r=Path('/private/tmp/willyou-m12-t131-T07-T14-App031-A-R-prep-005');env=dict(os.environ);env.update(WILLYOU_M12_NATIVE_LEASE_CONFIRMED='1',WILLYOU_TEST_CACHE_DIR=str(r/'execution-cache'),NODE_COMPILE_CACHE=str(r/'execution-cache/node'));awake=subprocess.Popen(['/usr/bin/caffeinate','-d','-i','-t','2700']);receipt={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'wrapperPid':os.getpid(),'awakePID':awake.pid,'command':['/usr/bin/caffeinate','-d','-i','-t','2700'],'scope':'Temporary own helper prevents idle display/system sleep only, no focus or settings changes; terminate own child after test'};(r/'root-awake-start.json').write_text(json.dumps(receipt,indent=2)+'\n')
try:
 child=subprocess.Popen(['/Users/liubu/.hermes/node/bin/node',str(r/'run-all.mjs'),'--execute'],env=env);receipt['driverPID']=child.pid;(r/'root-awake-start.json').write_text(json.dumps(receipt,indent=2)+'\n');code=child.wait()
finally:
 if awake.poll() is None:awake.terminate()
 awake.wait(timeout=5);receipt.update(finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),awakeExit=awake.returncode,helperReaped=True);(r/'root-awake-cleanup.json').write_text(json.dumps(receipt,indent=2)+'\n')
raise SystemExit(code)
