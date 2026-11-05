#!/usr/bin/python3
import os,sys,re,json,time,subprocess,shutil
from pathlib import Path
root=Path(os.environ['M12_NAVI_ROOT']);phase=os.environ['M12_NAVI_PHASE'];events=root/'runtime-001'/'agent-events.jsonl'
def event(row):
 row.update(phase=phase,atMs=time.time_ns()//1000000)
 with events.open('a')as f:f.write(json.dumps(row)+'\n');f.flush()
if '--version'in sys.argv:print('codex-cli 0.166.0');sys.exit(0)
if sys.argv[1:3]==['app-server','--print-startup-config']:print(json.dumps({'appServerVersion':'0.166.0','configRequirements':{'requirements':None}}));sys.exit(0)
if 'exec'in sys.argv:
 marker=re.search(r'SMARTDD-OK-[0-9a-f]{8}',' '.join(sys.argv))
 if not marker:sys.exit(70)
 print(marker.group());sys.exit(0)
event({'kind':'receiver-ready','pid':os.getpid(),'hasCliToken':bool(os.environ.get('WILLYOU_RUN_TOKEN')),'hasCliEndpoint':bool(os.environ.get('WILLYOU_ENDPOINT')),'endpointPath':os.environ.get('WILLYOU_ENDPOINT'),'boundary':'Synthetic health/requirements only; actual TaskService PTY and nativeCLI/M11. Not real model R.'})
print('[A] Navigation/settings receiver ready',flush=True)
# Trusted scheduling only: the original pinned CLI still authenticates against
# this actual managed root. No host state/result/approval is manufactured.
gate=events.parent/('precheck-gate-'+phase+'.json');deadline=time.monotonic()+20
while not gate.exists():
 if time.monotonic()>deadline:event({'kind':'cli-precheck-result','code':None,'signal':None,'skipped':True,'reason':'trusted precheck gate timeout'});break
 time.sleep(.02)
else:
 config=json.loads(gate.read_text())
 if config.get('skip'):event({'kind':'cli-precheck-result','code':None,'signal':None,'skipped':True,'reason':'actual host CLI plan or environment unavailable'})
 else:
  precheck_binary=shutil.which('willyou-app')
  if not precheck_binary:event({'kind':'cli-precheck-result','code':None,'signal':None,'skipped':True,'reason':'actual managed native CLI missing'})
  else:
   precheck_start=time.monotonic_ns();precheck_child=subprocess.Popen([precheck_binary,'browser','identity','get'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);event({'kind':'cli-precheck-start','pid':precheck_child.pid,'args':['browser','identity','get']})
   try:precheck_stdout,precheck_stderr=precheck_child.communicate(timeout=15)
   except subprocess.TimeoutExpired:
    event({'kind':'cli-precheck-timeout','pid':precheck_child.pid});precheck_child.terminate();precheck_stdout,precheck_stderr=precheck_child.communicate(timeout=3)
   try:precheck_parsed=json.loads(precheck_stdout)
   except json.JSONDecodeError:precheck_parsed=None
   event({'kind':'cli-precheck-result','pid':precheck_child.pid,'code':precheck_child.returncode if precheck_child.returncode>=0 else None,'signal':None if precheck_child.returncode>=0 else -precheck_child.returncode,'stdout':precheck_stdout,'stderr':precheck_stderr,'parsed':precheck_parsed,'elapsedNs':time.monotonic_ns()-precheck_start})
used=False;snapshot_seen=set()
for line in sys.stdin:
 event({'kind':'terminal-input','line':line.strip()})
 match_snapshot=re.fullmatch(r'NAVI SNAPSHOT (ylight|ydark) ([A-Za-z0-9-]+)',line.strip())
 if match_snapshot:
  tag,page_id=match_snapshot.groups()
  if tag in snapshot_seen:event({'kind':'duplicate-snapshot-refused','tag':tag});continue
  snapshot_seen.add(tag);binary=shutil.which('willyou-app')
  if not binary:event({'kind':'fixture-error','error':'ActualManagedCLIAbsent'});break
  start=time.monotonic_ns();child=subprocess.Popen([binary,'browser','snapshot','--page',page_id],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);event({'kind':'cli-snapshot-start','pid':child.pid,'tag':tag,'pageId':page_id,'args':['browser','snapshot','--page',page_id]})
  try:stdout,stderr=child.communicate(timeout=30)
  except subprocess.TimeoutExpired:
   event({'kind':'fixture-timeout','pid':child.pid,'tag':tag});child.terminate();stdout,stderr=child.communicate(timeout=4)
  event({'kind':'cli-snapshot-result','pid':child.pid,'tag':tag,'pageId':page_id,'code':child.returncode if child.returncode>=0 else None,'signal':None if child.returncode>=0 else -child.returncode,'stdout':stdout,'stderr':stderr,'elapsedNs':time.monotonic_ns()-start});print(stdout.strip(),flush=True)
  continue
 if line.strip()!='NAVI IDENTITY' or used:continue
 used=True;binary=shutil.which('willyou-app')
 if not binary:event({'kind':'fixture-error','error':'Managed CLI missing'});break
 start=time.monotonic_ns();child=subprocess.Popen([binary,'browser','identity','get'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);event({'kind':'cli-start','pid':child.pid,'args':['browser','identity','get']})
 try:stdout,stderr=child.communicate(timeout=30)
 except subprocess.TimeoutExpired:
  event({'kind':'fixture-timeout','pid':child.pid});child.terminate();stdout,stderr=child.communicate(timeout=4)
 event({'kind':'cli-result','pid':child.pid,'code':child.returncode if child.returncode>=0 else None,'signal':None if child.returncode>=0 else -child.returncode,'stdout':stdout,'stderr':stderr,'elapsedNs':time.monotonic_ns()-start});print(stdout.strip(),flush=True)
