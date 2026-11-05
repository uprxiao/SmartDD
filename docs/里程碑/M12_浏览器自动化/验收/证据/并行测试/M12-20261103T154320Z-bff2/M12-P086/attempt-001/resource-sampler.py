#!/Library/Frameworks/Python.framework/Versions/3.11/bin/python3
"""Persistent read-only OS sampler; stdin blocks between explicitly scheduled samples.
CPU counters are per-process user+system seconds, never ps lifetime averages.
Only owned App process records are emitted, never command lines or environments.
"""
import sys,json,time,os
from pathlib import Path
import psutil
known={}
def sample(req):
 start_ns=time.monotonic_ns();start_wall_ns=time.time_ns();allrows={};read_errors=[]
 for proc in psutil.process_iter(['pid','ppid','name','exe','create_time'],ad_value=None):
  info=proc.info;allrows[info['pid']]=info
 seeds={req['appPid']}|set(req.get('electronMetricPids',[]))|set(req.get('helperPids',[]))
 reasons={pid:{'current-host-seed'} for pid in seeds}
 prefix=req['appBundle'].rstrip('/')+'/'
 for pid,info in allrows.items():
  if info.get('exe','') and info['exe'].startswith(prefix):reasons.setdefault(pid,set()).add('exact-test-app-bundle-executable')
  old=known.get(pid)
  if old and info.get('create_time')==old['createdAtEpochSeconds']:reasons.setdefault(pid,set()).add('previous-owned-same-birth')
 changed=True
 while changed:
  changed=False
  for pid,info in allrows.items():
   if info.get('ppid') in reasons and pid not in reasons:reasons[pid]={'current-owned-descendant'};changed=True
 records=[]
 for pid,why in sorted(reasons.items()):
  try:
   proc=psutil.Process(pid)
   with proc.oneshot():
    born=proc.create_time();cpu=proc.cpu_times();memory=proc.memory_info();ppid=proc.ppid();exe=proc.exe();name=proc.name();threads=proc.num_threads()
   if not proc.is_running():raise psutil.NoSuchProcess(pid)
   row={'pid':pid,'ppid':ppid,'createdAtEpochSeconds':born,'identity':str(pid)+':'+format(born,'.6f'),'name':name,'executable':exe,'rssBytes':memory.rss,'userCpuSeconds':cpu.user,'systemCpuSeconds':cpu.system,'cpuSeconds':cpu.user+cpu.system,'threads':threads,'ownership':sorted(why)}
   records.append(row);known[pid]=row
  except (psutil.NoSuchProcess,psutil.AccessDenied,psutil.ZombieProcess) as exc:read_errors.append({'pid':pid,'class':type(exc).__name__,'ownership':sorted(why)})
 return {'kind':'actual-os-sample','requestId':req['requestId'],'atUtc':time.strftime('%Y-%m-%dT%H:%M:%S',time.gmtime())+'Z','samplingStartedWallNs':start_wall_ns,'wallTimeNs':time.time_ns(),'systemCpuTimes':psutil.cpu_times()._asdict(),'availableSystemMemoryBytes':psutil.virtual_memory().available,'monotonicNs':time.monotonic_ns(),'samplingDurationNs':time.monotonic_ns()-start_ns,'processes':records,'rssTotalBytes':sum(x['rssBytes'] for x in records),'readErrors':read_errors,'samplerPid':os.getpid(),'logicalCpuCount':psutil.cpu_count(),'method':'psutil7.0.0 actual macOS per-PID cumulative user+system CPU seconds and resident RSS;100%=one logical core; no lifetime percentage; no command-line/environment reads'}
for line in sys.stdin:
 try:
  req=json.loads(line)
  if req.get('type')=='stop':print(json.dumps({'kind':'sampler-stopped','pid':os.getpid(),'knownIdentities':[{'pid':r['pid'],'createdAtEpochSeconds':r['createdAtEpochSeconds'],'identity':r['identity']}for r in known.values()]}),flush=True);break
  print(json.dumps(sample(req)),flush=True)
 except Exception as exc:print(json.dumps({'kind':'sampler-error','class':type(exc).__name__,'message':str(exc)}),flush=True)
