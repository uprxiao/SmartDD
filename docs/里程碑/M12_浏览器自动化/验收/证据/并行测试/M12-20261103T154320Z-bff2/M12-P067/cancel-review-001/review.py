#!/usr/bin/env python3
"""File-only independent review; never imports the old judge or modifies evidence."""
import json, hashlib
from pathlib import Path
from datetime import datetime, timezone
ROOT=Path(__file__).resolve().parent
ORIGINAL=Path('/private/tmp/willyou-m12-p067-pause-stop-app021-006')
SOURCE=Path('/private/tmp/willyou-m12-p101-source-025/source')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def iso(ms):return datetime.fromtimestamp(ms/1000,timezone.utc).isoformat(timespec='milliseconds')
original_hashes={n:sha(ORIGINAL/n) for n in ['raw.json','result.json','judge.mjs']}
r=json.loads((ORIGINAL/'raw.json').read_text()); old=json.loads((ORIGINAL/'result.json').read_text())
task=r['tasks']['T1']['task']['id']; run=r['sessions']['T1']['value']['currentRun']['id']; page=r['pages']['one']['pageId']; project=r['projectId']
def candidates(run_id=run,task_id=task,page_id=page,command='wait'):
 return [d['value'] for d in r['stopAuditDetails'] if d.get('ok') and d['value']['item'].get('runId')==run_id and d['value']['item'].get('taskId')==task_id and d['value']['item'].get('projectId')==project and d['value']['browser'] and d['value']['browser'].get('command')==command and d['value']['browser'].get('pageId')==page_id and d['value']['browser'].get('arguments',{}).get('text')=='P067StopNeverAppears' and d['value']['browser'].get('arguments',{}).get('timeout')==90000]
assert len(candidates())==1
wait=candidates()[0]; item=wait['item']
checks=[]
def check(name,condition):
 checks.append({'id':name,'passed':bool(condition)})
 if not condition: raise AssertionError(name)
old_selected=[x for x in r['stopAudit']['value']['items'] if x.get('runId')==run and x.get('action')=='wait']
check('original-empty-filter-reproduced',not old_selected)
check('real-current-scope-wait-detail',item['action']=='browser.nav.wait' and item['callerKind']=='agent-run' and item['semantics']=='read' and item['attemptCount']==1)
check('original-item-matches-detail',sum(x==item for x in r['stopAudit']['value']['items'])==1)
check('before-stop-one-real-readwait',r['stopWaitActive']['service']['readWaits']==[{'taskId':task,'size':1}])
check('after-stop-no-readwait',not any(x['taskId']==task and x['size'] for x in r['stopAfter']['service']['readWaits']) and not any(x['taskId']==task and x['size'] for x in r['stopFinal']['service']['readWaits']))
check('real-run-ended',r['stopAfter']['sessions']['T1']['value']['currentRun'] is None and r['stopFinal']['sessions']['T1']['value']['currentRun'] is None)
kill=[x for x in r['stopUiCalls'] if x['name']=='tasks.kill' and x['phase']=='called' and x['args']==[task]]
check('actual-trusted-ui-kill',len(kill)==1 and kill[0]['mainFrame'] is True and kill[0]['atMs']==r['stopHandlerAtMs'])
events=r['observerRestorations'][next(i for i,x in enumerate(r['observerRestorations']) if x['instance']=='restart')]['helper']['state']['events']
callbacks=[x for x in events if x['kind']=='actual-helper-callback' and x.get('command')==['wait','--text','P067StopNeverAppears','--timeout','90000']]
check('one-original-wait-callback',len(callbacks)==1)
cb=callbacks[0]
check('real-helper-cancel-after-ui-stop',cb['atMs']>=r['stopHandlerAtMs'] and cb['raw']['error']['signal']=='SIGTERM')
check('real-terminal-host-result',item['state']=='failed' and item['errorCode']=='BROWSER_ERROR' and item['effectState']=='read-only' and item['endedAt'] is not None)
check('no-fabricated-cli-result',r['stopWaitObserved']['transportLostObservation']['reportedByCli'] is False and r['stopWaitPartial']['stdout']=='' and r['stopWaitPartial']['stderr']=='')
for key,value in [('run_id','wrong-run'),('task_id','wrong-task'),('page_id','wrong-page'),('command','wrong-command')]:
 check('negative-'+key,not candidates(**{key:value}))
ss=r['activitySamples']; active=[(s,v) for s in ss for v in s['hostActivities'] if v['pageId']==page]; absent=[s for s in ss if not any(v['pageId']==page for v in s['hostActivities'])]
end=active[0][1]['endedAt']; deadline=end+20000; maxgap=max(b['atMs']-a['atMs'] for a,b in zip(ss,ss[1:]))
check('activity-original-host-deadlines',all(v['running']==0 and v['endedAt']==end and v['deadlineMs']==deadline for _,v in active))
check('activity-samples-bracket-deadline',active[-1][0]['atMs']<deadline<=absent[0]['atMs']<=deadline+maxgap)
check('actual-ui-and-workspace-cleared',absent[0]['ui']['activeDots']==0 and absent[0]['ui']['activeGlow']==0 and not any(x['agentActive'] for x in r['stopFinal']['workspaces']['T1']['tabs']))
check('all-original-other-checks-green',all(x['status']=='passed' for x in old['checks'] if x['id']!='S03'))
check('original-evidence-byte-unchanged',all(sha(ORIGINAL/n)==h for n,h in original_hashes.items()))
source_specs=[('src/main/core/applications/execution-context.ts',280,290),('src/main/core/applications/activity-service.ts',39,45),('src/main/core/applications/activity-service.ts',59,65),('src/main/core/browser/audit.ts',55,79),('src/main/core/browser/automation.ts',34,53)]
sources=[]
for rel,a,b in source_specs:
 p=SOURCE/rel; sources.append({'path':str(p),'sha256':sha(p),'lineStart':a,'lineEnd':b,'text':'\n'.join(p.read_text().splitlines()[a-1:b])})
proof={'reviewedAt':datetime.now(timezone.utc).isoformat(),'mode':'file-only derived review; no original mutation, no SQLite needed','classification':'driver/schema mismatch: old short action wait versus unified capability action browser.nav.wait','original':{'root':str(ORIGINAL),'hashes':original_hashes,'S03':next({k:v for k,v in x.items() if k!='actual'} for x in old['checks'] if x['id']=='S03'),'oldFilterMatchedCount':0},'scope':{'projectId':project,'taskId':task,'runId':run,'pageId':page},'realHostItem':item,'realBrowserDetails':wait['browser'],'timeline':{'uiStopClickedAtMs':r['stopClickedAtMs'],'uiKillHandlerAtMs':r['stopHandlerAtMs'],'logicalRunCommandCancelledAtMs':end,'helperWaitCallbackAtMs':cb['atMs'],'helperSignal':cb['raw']['error']['signal'],'hostActivityEndedAt':item['endedAt'],'firstFinalReadWaitEmptyAtMs':r['stopAfter']['atMs'],'hostActivityDelayFromLogicalCancelMs':int(datetime.fromisoformat(item['endedAt'].replace('Z','+00:00')).timestamp()*1000)-end},'cliObservation':{'reportedByCli':False,'stdout':'','stderr':'','numericExitObserved':None,'note':'receiver stopped on task kill; no synthesized CLI completion/error result'},'activity':{'sampleCount':len(ss),'activeSamples':len(active),'maxGapMs':maxgap,'logicalEndAtMs':end,'deadlineMs':deadline,'deadlineUtc':iso(deadline),'lastActiveAtMs':active[-1][0]['atMs'],'firstAbsentAtMs':absent[0]['atMs'],'firstAbsentUiAtMs':absent[0]['ui']['atMs'],'firstAbsentDelayMs':absent[0]['atMs']-deadline,'activeDots':absent[0]['ui']['activeDots'],'activeGlow':absent[0]['ui']['activeGlow'],'boundary':'20s measured from actual main-process logical cancellation/endRun; Helper callback and M11 audit persistence complete 89ms/141ms later, not asserted identical. Timer expiry observed within original 88ms sample spacing.'},'sources':sources,'checks':checks,'conclusion':{'S03Original':'failed, retained','S03Independent':'passed: original UI-stop cancellation requirement supported by raw real Helper callback, current scoped Host item and empty readwait/run state','productDefectFound':False,'formalCaseIncrement':0,'coordinatorDecisionRequired':True,'boundary':'No new Native/App/model/SQLite run; other original case checks remain their original evidence and applicability.'}}
(ROOT/'proof.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
(ROOT/'result.json').write_text(json.dumps({'classification':proof['classification'],'S03':'independent evidence closes original requirement','checksPassed':sum(x['passed'] for x in checks),'checksTotal':len(checks),'formalCaseIncrement':0,'originalUnchanged':True,'resourcesHeld':[],'productDefectFound':False},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'checks':len(checks),'classification':proof['classification'],'originalUnchanged':True,'output':str(ROOT)},ensure_ascii=False))
