import json,hashlib,copy,datetime
from pathlib import Path
ROOT=Path('/private/tmp/willyou-m12-t114-accepted-timing-003')
RAW=Path('/private/tmp/willyou-m12-p067-pause-stop-app021-006/raw.json')
EXPECTED='95089836221648c7c98003c0181397669da8fe1c2a276f08b6488c5d13973fb1'
rawbytes=RAW.read_bytes();assert hashlib.sha256(rawbytes).hexdigest()==EXPECTED
raw=json.loads(rawbytes)
def timing(r):
 assert r['asarSha256']=='7b63bb817a9047656f4fe268fae4a4ea20d2f17b472c6dce417dccad837d0fd6'
 task=r['stopAfter']['workspaces']['T1']['taskId'];page=r['stopAfter']['workspaces']['T1']['activeId']
 assert task and page
 a=next(x for x in r['stopAfter']['service']['automation'] if x['pageId']==page and x['taskId']==task)
 anchor=a['endedAt'];assert isinstance(anchor,int) and a['deadlineMs']==anchor+20000
 active=[];clear=[]
 for s in r['activitySamples']:
  u=s['ui'];assert s['workspace']['taskId']==task and u['panelTask']==task and u['selectedTask']==task
  ts=u['atMs'];tabs=s['workspace']['tabs'];p=next(t for t in tabs if t['id']==page)
  if anchor+19000<=ts<anchor+20000 and u['activeDots']>0 and u['activeGlow']>0 and p['agentActive']:active.append(s)
  if anchor+19000<ts<=anchor+21000 and u['activeDots']==0 and u['activeGlow']==0 and all(not t['agentActive'] for t in tabs):clear.append(s)
 assert active and clear
 before=active[0];after=clear[0];assert after['ui']['atMs']>before['ui']['atMs']
 return {'taskId':task,'pageId':page,'producerEndAtMs':anchor,'activeObservedMs':before['ui']['atMs']-anchor,'clearObservedMs':after['ui']['atMs']-anchor,'activeDots':before['ui']['activeDots'],'activeGlow':before['ui']['activeGlow'],'clearDots':after['ui']['activeDots'],'clearGlow':after['ui']['activeGlow']}
positive=timing(raw);negative=[]
for name in ['no-active','no-clear','wrong-page','wrong-task','early-only','late-clear','active-workspace-mismatch','wrong-deadline']:
 x=copy.deepcopy(raw)
 if name=='no-active':x['activitySamples']=[s for s in x['activitySamples'] if not s['ui']['activeDots']]
 if name=='no-clear':x['activitySamples']=[s for s in x['activitySamples'] if s['ui']['activeDots']]
 if name=='wrong-page':x['stopAfter']['workspaces']['T1']['activeId']='missing'
 if name=='wrong-task':x['stopAfter']['workspaces']['T1']['taskId']='wrong-task'
 if name=='early-only':
  for s in x['activitySamples']:
   if s['ui']['activeDots']:s['ui']['atMs']=positive['producerEndAtMs']+18000
 if name=='late-clear':
  for s in x['activitySamples']:
   if not s['ui']['activeDots']:s['ui']['atMs']=positive['producerEndAtMs']+22000
 if name=='active-workspace-mismatch':
  for s in x['activitySamples']:
   for t in s['workspace']['tabs']:t['agentActive']=False
 if name=='wrong-deadline':
  for a in x['stopAfter']['service']['automation']:a['deadlineMs']+=1
 try:timing(x)
 except (AssertionError,StopIteration,KeyError):negative.append({'id':name,'rejected':True})
 else:raise AssertionError('Negative accepted:'+name)
base=Path('docs/里程碑/M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2')
original_bytes=Path('/private/tmp/willyou-m12-p067-pause-stop-app021-006/result.json').read_bytes();assert hashlib.sha256(original_bytes).hexdigest()=='018cac60e0a5a013e1c0c9e30131f09b627041cec150e641e417f0f4726557ae';original=json.loads(original_bytes);oldchecks={c['id']:c for c in original['checks']}
for k in ['S01','S02','S04','S06']:assert oldchecks[k]['status']=='passed'
cancel=base/'M12-P067/cancel-review-001/result.json';c=json.loads(cancel.read_text());assert c['checksPassed']==c['checksTotal']==20 and c['S03']=='independent evidence closes original requirement'
coord=base/'M12-P067/coordinator-review-006/coordinator-review.json';v=json.loads(coord.read_text());assert v['checksPassed']==20 and '34PID11TCP3Helper/Unixclear' in v['cleanup']
auto=Path('src/main/core/browser/automation.ts');assert hashlib.sha256(auto.read_bytes()).hexdigest()=='32e461338e9fa1d24b2bde04d86c5d4c754428812c4c57b5c388c8704a0c9c43'
out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'case':'M12-T114','status':'passed under explicitly accepted 19s/21s timing; coordinator final ledger pending','authorizationReference':'request_user_input_async/call_7fed2d48565448f4a77825d8dd8b74b3/0; actual user answer: 统一为第 19 秒显示、第 21 秒清除','oldStrictTimingRecordRetained':True,'criteria':{'S01/S02/S04/S06':'original actual App021 A passed','S03':'previous independent20/20 closes actual canceled browser.nav.wait alias','S05Accepted19/21':positive,'normalCleanup':'both exact actual App0/null/signals[];34PID11TCP3Helper/Unix clear; previous current source025 review unchanged'},'negativeControls':negative,'inputs':[{'path':str(RAW),'sha256':EXPECTED},{'path':str(cancel),'sha256':hashlib.sha256(cancel.read_bytes()).hexdigest()},{'path':str(coord),'sha256':hashlib.sha256(coord.read_bytes()).hexdigest()},{'path':str(auto),'sha256':hashlib.sha256(auto.read_bytes()).hexdigest()}],'boundary':'Original actual raw not changed or rerun. New explicit user contract applied now; no claim original strict<=20s proved or failed. No production change, Native, new UI or clock override.'}
(ROOT/'coordinator-review.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'T114':'accepted timing evidence passed','activeMs':positive['activeObservedMs'],'clearMs':positive['clearObservedMs'],'negativeControls':len(negative)},ensure_ascii=False))
