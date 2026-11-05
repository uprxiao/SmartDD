from pathlib import Path
import json,math
root=Path(__file__).parent
raw=json.loads((root/'raw.json').read_text())
samples=[json.loads(line)for line in (root/'resource-samples.jsonl').read_text().splitlines()if line] if (root/'resource-samples.jsonl').exists()else []
checks=[]
def check(name,description,fn):
 try:actual=fn();assert actual is True;checks.append({'id':name,'expected':description,'status':'passed'})
 except Exception as exc:checks.append({'id':name,'expected':description,'status':'failed-or-needs-analysis','error':str(exc)})
points=raw.get('milestones',[]);expected=[0,5,10,15,20,25,30]
check('T111-I01-complete-duration','All5 real pages parked for full1800monotonic seconds, seven original checkpoints',lambda:len(raw['pages'])==5 and [x['minute']for x in points]==expected and int(raw['measurementEndMonoNs'])-int(raw['measurementStartMonoNs'])>=1800_000_000_000 and all(x['before']['elapsedSeconds']>=x['minute']*60 for x in points))
def commands_ok():
 for point in points:
  items=point['commands']['commands'];assert len(items)==5
  for item in items:
   result=item['result'];value=json.loads(result['stdout']);assert result['code']==0 and value['status']=='ok';page=next(p for p in raw['pages']if p['role']==item['role']);assert value['data']['browserPageId']==page['pageId']and value['data']['url']==page['url'];assert value['operation']['effectState']=='read-only'and value['operation']['origin']=='cli'
   assert len([x for x in raw['agentEvents']if x['kind']=='cli-start'and x['role']==item['role']and x['sample']==str(point['minute'])])==1
 all_results=[json.loads(item['result']['stdout'])for point in points for item in point['commands']['commands']];assert len({v['operation']['requestId']for v in all_results})==35
 return len(points)==7
check('T111-I02-all35-actualCLI','Every5minutes all5 tasks genuine nativeCLI snapshot succeeds, no replay',commands_ok)
def identities_ok():
 baseline={x['pageId']:x for x in raw['baseline']['pages']}
 for point in points:
  for page in point['native']['pages']:
   before=baseline[page['pageId']];assert page['wcId']==before['wcId'] and not page['destroyed']
   for key in ['documentId','url','value','width','height']:assert page['value'][key]==before['value'][key],key
   assert len(page['parents'])==1 and page['parents'][0]['visible'] and page['parents'][0]['opacity']==0 and not page['parents'][0]['focusable'];assert page['parents'][0]['id']==before['parents'][0]['id']
   assert page['preferences']==before['preferences'] and page['preferences']['sandbox'] and page['preferences']['contextIsolation'] and not page['preferences']['nodeIntegration'] and not page['preferences']['backgroundThrottling']
 return len(baseline)==5
check('T111-I03-parked-identity-settings','Same5 WC/doc/page state/size and real production transparent shown park, original security/background prefs',identities_ok)
rss={x['minute']:x['before']['rssTotalBytes']for x in points}
check('T111-S01-RSS30vs10','Total RSS30 <=110% RSS10, exact byte comparison without rounding tolerance',lambda:rss[30]*100<=rss[10]*110)
last=[rss.get(n)for n in [15,20,25,30]]
check('T111-S02-last4-RSS','Last4 milestone RSS samples are not continuously strictly rising; no noise threshold added',lambda:None not in last and not all(a<b for a,b in zip(last,last[1:])))
ranges=raw.get('activityRanges',[]);intervals=[]
measured=[x for x in samples if x.get('elapsedSeconds')is not None and x['kind']!='cleanup-observation']
for a,b in zip(measured,measured[1:]):
 a_node=int(a['requestedAtDriverMonoNs']);b_node=int(b['receivedAtDriverMonoNs']);active=any(int(w['startMonoNs'])<b_node and int(w.get('endMonoNs',b_node))>a_node for w in ranges)
 dt=(int(b['monotonicNs'])-int(a['monotonicNs']))/1e9;previous={x['identity']:x for x in a['processes']};current={x['identity']:x for x in b['processes']};missing=sorted(set(previous)-set(current));new=sorted(set(current)-set(previous));delta=sum(max(0,current[k]['cpuSeconds']-previous[k]['cpuSeconds'])for k in set(previous)&set(current));negative=[k for k in set(previous)&set(current)if current[k]['cpuSeconds']<previous[k]['cpuSeconds']]
 gaps=[]
 if missing:gaps.append({'kind':'exited-process-final-counter-unavailable','identities':missing})
 if new:gaps.append({'kind':'new-process-between-samples','identities':new})
 if a['readErrors']or b['readErrors']:gaps.append({'kind':'OS-counter-read-error','before':a['readErrors'],'after':b['readErrors']})
 if negative:gaps.append({'kind':'counter-decreased','identities':negative})
 wall_dt=(int(b['wallTimeNs'])-int(a['wallTimeNs']))/1e9
 if abs(wall_dt-dt)>.5:gaps.append({'kind':'wall-versus-monotonic-discontinuity','wallSeconds':wall_dt,'monotonicSeconds':dt})
 intervals.append({'startElapsedSeconds':a['elapsedSeconds'],'endElapsedSeconds':b['elapsedSeconds'],'seconds':dt,'idle':not active,'knownCpuSecondsDelta':delta,'oneCorePercent':delta/dt*100 if dt>0 else None,'complete':not gaps and dt>0,'gaps':gaps})
idle=[x for x in intervals if x['idle']];complete=[x for x in idle if x['complete']];gaps=[x for x in idle if not x['complete']];total_dt=sum(x['seconds']for x in complete);cpu=sum(x['knownCpuSecondsDelta']for x in complete)/total_dt*100 if total_dt else None
cpu_analysis={'method':'Actual per-PID user+system cumulative CPU difference / actual monotonic seconds *100;100%=one logical core, no division by logicalCpuCount. Only intervals not overlapping real command activity are idle. All idle peaks retained.','idleWeightedOneCorePercent':cpu,'measuredCompleteIdleSeconds':total_dt,'idleIntervalCount':len(idle),'incompleteIdleIntervals':gaps,'intervals':intervals,'boundary':'A new/exited PID between idle samples creates a coverage gap; unknown final CPU is not silently zero and prevents automatic pass until analyzed.'};(root/'cpu-analysis.json').write_text(json.dumps(cpu_analysis,indent=2)+'\n')
check('T111-S03-complete-idle-CPU-observation','Actual idle interval CPU coverage has no unaccounted PID lifetime/counter gaps',lambda:bool(idle)and not gaps)
check('T111-S04-idle-CPU-under5','Time-weighted complete idle App aggregate CPU <5% of one logical core',lambda:cpu is not None and cpu<5)
check('T111-S05-full-owned-process-scope','Actual OS samples include main, allElectron metric PIDs and page-owned Helper daemons; no read errors',lambda:bool(measured)and all(not x['readErrors'] and {e['pid']for e in x['electronMetrics']}<={v['pid']for v in x['processes']} and set(sum([h['pids']for h in x['helpers']],[]))<={v['pid']for v in x['processes']} for x in measured))
check('T111-quit-and-cleanup','Actual App normal0/null, no forced App close, all mandatory cleanup succeeded',lambda:raw.get('status')=='executed-unjudged' and raw.get('normalExit',{}).get('code')==0 and raw['normalExit'].get('signal')is None and not raw.get('harnessProcessReceipt',{}).get('signals') and not raw['cleanupErrors'] and raw['serverClosed'])
out={'at':raw.get('finishedAt'),'case':'M12-T111','layers':['I','S'],'status':'passed-pending-independent-cleanup' if all(x['status']=='passed'for x in checks)else'needs-analysis-or-partial','checks':checks,'rssMilestoneBytes':rss,'lastFourRssBytes':last,'rss30Over10Ratio':rss.get(30,0)/rss[10] if rss.get(10)else None,'idleWeightedOneCoreCpuPercent':cpu,'cpuAnalysis':'cpu-analysis.json','formalLedgerModified':False,'boundary':'Original raw retained; resource excess/coverage gaps require diagnosis before conclusion, no restart or filtering to make pass.'};(root/'adjudication.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:out[k]for k in ['status','rss30Over10Ratio','idleWeightedOneCoreCpuPercent']}));print('failed',[x['id']for x in checks if x['status']!='passed'])
