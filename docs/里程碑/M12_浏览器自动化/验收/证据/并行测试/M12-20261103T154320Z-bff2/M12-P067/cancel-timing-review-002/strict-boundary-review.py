import json,hashlib
from pathlib import Path
from datetime import datetime,timezone
P=Path(__file__).resolve().parent
O=Path('/private/tmp/willyou-m12-p067-pause-stop-app021-006')
S=Path('/private/tmp/willyou-m12-p101-source-025/source')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
r=json.loads((O/'raw.json').read_text()); page=r['pages']['one']['pageId'];samples=r['activitySamples']
active=[s for s in samples if any(v['pageId']==page for v in s['hostActivities'])];absent=[s for s in samples if not any(v['pageId']==page for v in s['hostActivities'])];end=next(v['endedAt'] for v in active[0]['hostActivities'] if v['pageId']==page); deadline=end+20000
lastUi=max(s['ui']['atMs'] for s in samples if s['ui']['activeDots'] or s['ui']['activeGlow']); firstAbsentUi=min(s['ui']['atMs'] for s in samples if not s['ui']['activeDots'] and not s['ui']['activeGlow'])
def adjudicate(lastPresent,firstAbsent,deadline):
 if firstAbsent<=deadline:return 'proved-within-bound'
 if lastPresent>=deadline:return 'proved-exceeded-bound'
 return 'incomplete: interval straddles strict bound'
assert adjudicate(deadline-10,deadline-1,deadline)=='proved-within-bound'
assert adjudicate(deadline+1,deadline+2,deadline)=='proved-exceeded-bound'
assert adjudicate(deadline-1,deadline+1,deadline).startswith('incomplete')
assert adjudicate(lastUi,firstAbsentUi,deadline).startswith('incomplete')
# These are the complete installed observer input files; neither instruments DOM mutation or activity expiry.
observerPaths=[O/'ui-rpc-observer.js',O/'monitor-function.js']
assert all('MutationObserver' not in p.read_text() for p in observerPaths)
findings={'scope':'file-only supplemental strict T114/S05 boundary review; supersedes any interpretation that S05 green proves strict20s','S03':'closed independently: schema-filter error; original result retained','S05Strict20s':'incomplete','productFailureProven':False,'wholeT114PassRecommended':False,'formalCaseIncrement':0,'anchors':{'logicalEndRunActivityFinishAtMs':end,'actualHelperWaitCallbackAtMs':1793882993364,'unifiedM11EndedAtMs':1793882993416,'logicalDeadlineMs':deadline,'reason':'BrowserAutomation.endRun invokes idempotent token.finish on run abort; token.finish stamps endedAt and schedules +20000. Later Helper termination/Host audit persistence are not silently substituted for this producer anchor.'},'hostSnapshotInterval':{'lastPresentReadCompletedAtMs':active[-1]['atMs'],'firstAbsentReadCompletedAtMs':absent[0]['atMs'],'relativeMs':[active[-1]['atMs']-deadline,absent[0]['atMs']-deadline]},'uiSnapshotInterval':{'lastPresentExpressionAtMs':lastUi,'firstAbsentExpressionAtMs':firstAbsentUi,'relativeMs':[lastUi-deadline,firstAbsentUi-deadline],'strictAdjudication':adjudicate(lastUi,firstAbsentUi,deadline),'timestampBoundary':'Date.now captured by synchronous DOM snapshot expression; not a MutationObserver removal timestamp.'},'observability':{'mutationObserverInstalled':False,'actualActivityTimerCallbackTimestampRecorded':False,'existingMonitors':['UI business RPC call/return log','WC/window/navigation/quit monitor','receiver/CLI events','periodic workspace/UI/automation snapshots'],'conclusion':'No recorded event resolves on which side of the deadline actual DOM mark removal occurred. Source setTimeout20s guarantees no early callback but not <=20s firing/display; cannot use source or sampling tolerance as strict upper-bound proof.'},'decision':'S03 driver failure corrected by existing actual evidence; S05 original green remains historical but independent strict boundary is unresolved, not a proven product overrun. Do not claim entire T114 pass from this evidence alone. No rerun/Native recommended or performed by this review. Coordinator should resolve the original20s wording/accepted time semantics rather than change expectations to obtain green.','inputs':[{'path':str(p),'sha256':sha(p)} for p in [O/'raw.json',O/'result.json',O/'judge.mjs',O/'run.mjs',*observerPaths,S/'src/main/core/browser/automation.ts']], 'resourcesHeld':[]}
(P/'result.json').write_text(json.dumps(findings,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'S03':findings['S03'],'S05Strict20s':findings['S05Strict20s'],'uiRelativeIntervalMs':findings['uiSnapshotInterval']['relativeMs'],'hostRelativeIntervalMs':findings['hostSnapshotInterval']['relativeMs'],'wholeT114PassRecommended':False}))
