from pathlib import Path
import json,datetime,subprocess,time,re,os
r=Path('/private/tmp/willyou-m12-awake-assertion-probe-002');p=Path('/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M12_浏览器自动化/验收/并行测试/轮次/M12-20261103T154320Z-bff2/轮次记录.json');d=json.loads(p.read_text());assert d['resources']['nativeUi']['status'].startswith('released');now=datetime.datetime.now(datetime.timezone.utc).isoformat();d['resources']['nativeDiagnostics']={'owner':'/root','status':'running/temporary owned powerassertion pulse002','privateRoot':str(r),'startedAt':now,'scope':'20s Node pulse under caffeinate -i -s on AC;no display/useractive assertion, no permanentsettings/App/UI/credentials'};p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');cmd=['/usr/bin/caffeinate','-i','-s','/Users/liubu/.hermes/node/bin/node',str(r/'pulse.mjs')];child=None;known=[];result={'startedAt':now,'command':cmd,'permanentSettingsChanged':False,'screenOrUserActiveAssertionRequested':False,'testOnly':True}
def exact():
 z=subprocess.run(['/bin/ps','-axo','pid=,ppid=,command='],capture_output=True,text=True,timeout=10);assert z.returncode==0;rows=[]
 for line in z.stdout.splitlines():
  m=re.match(r'^\s*(\d+)\s+(\d+)\s+(.+)$',line)
  if m and str(r/'pulse.mjs') in m[3] and m[3].split()[0] in ['/usr/bin/caffeinate','caffeinate','/Users/liubu/.hermes/node/bin/node']:rows.append({'pid':int(m[1]),'ppid':int(m[2]),'kind':'guard' if 'caffeinate' in m[3].split()[0] else 'pulse'})
 return rows
try:
 child=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=dict(os.environ,NODE_COMPILE_CACHE=str(r/'cache/node')));result['launcherPid']=child.pid
 end=time.monotonic()+5
 while not (r/'pulse-live.json').exists() and child.poll() is None and time.monotonic()<end:time.sleep(.05)
 live=json.loads((r/'pulse-live.json').read_text());assert live['pid']==child.pid and live['ppid']==os.getpid() and live['exe']=='/Users/liubu/.hermes/node/bin/node';result['pulsePid']=live['pid'];result['pidLayout']='caffeinate parent execs utility retaining launcherPID;guard child observed independently'
 end=time.monotonic()+3
 while time.monotonic()<end:
  known=exact();guards=[x for x in known if x['kind']=='guard' and x['ppid']==live['pid']]
  if len(guards)==1:break
  time.sleep(.05)
 assert len(guards)==1,known;result['powerGuardPid']=guards[0]['pid'];q=subprocess.run(['/usr/bin/pmset','-g','assertions'],capture_output=True,text=True,timeout=10);own=[line for line in q.stdout.splitlines() if re.search(r'\bpid\s+'+str(guards[0]['pid'])+r'\(caffeinate\)',line)];result['ownPreventIdleAssertionObserved']=any('PreventUserIdleSystemSleep' in x for x in own);result['ownPreventSystemAssertionObserved']=any('PreventSystemSleep' in x for x in own);assert result['ownPreventIdleAssertionObserved'] and result['ownPreventSystemAssertionObserved'];out,err=child.communicate(timeout=35);(r/'stdout.log').write_text(out);(r/'stderr.log').write_text(err);result['exitCode']=child.returncode;result['pulse']=json.loads((r/'pulse-result.json').read_text());assert child.returncode==0;v=result['pulse'];assert v['intervalsWithin750ms'] and v['wallMs']<=22000 and abs(v['wallMs']-v['monoMs'])<200;result['passed']=True
except Exception as e:result['passed']=False;result['error']={'type':type(e).__name__,'message':str(e)}
finally:
 if child is not None and child.poll() is None:
  child.terminate()
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
 end=time.monotonic()+5
 while time.monotonic()<end:
  remaining=exact()
  if not remaining:break
  time.sleep(.05)
 result['remainingExactOwnedCommands']=remaining;result['allOwnedCommandsExited']=not remaining;result['finishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();result['utilityExitCode']=child.returncode if child else None;(r/'result.json').write_text(json.dumps(result,indent=2)+'\n');d=json.loads(p.read_text());d['resources']['nativeDiagnostics'].update({'status':'complete/released' if not remaining else 'cleanup-only','finishedAt':result['finishedAt'],'powerGuardPid':result.get('powerGuardPid'),'pulsePid':result.get('pulsePid')});p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result))
