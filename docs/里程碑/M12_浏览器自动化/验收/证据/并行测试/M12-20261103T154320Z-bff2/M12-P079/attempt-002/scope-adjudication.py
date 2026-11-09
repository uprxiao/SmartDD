#!/usr/bin/env python3
"""Independent existing-raw reclassification; no new Native input or OS query."""
import hashlib,json
from pathlib import Path
R=Path(__file__).resolve().parent
E=[json.loads(x) for x in (R/'native-stdout.jsonl').read_text().splitlines()]
S=[x for x in E if x.get('kind')=='snapshot']
original=json.loads((R/'result.json').read_text())
scale=original['observations']['unitCalibration']['compatibleCandidates'][0]['rawUnitsPerSecond']
def sample(label):
    rows=[x for x in S if x['label']==label]
    assert len(rows)==1
    return rows[0]
def own(s):assert s['v2']['rc']==0;return s['v2']['user']+s['v2']['system']
def child(s):assert s['v2']['rc']==0;return s['v2']['childUser']+s['v2']['childSystem']
wn=[x for x in E if x.get('kind')=='terminated-unreaped-observed']
rows=[]
for stage in ['V5-live','V5-grand-zombie','V5-grand-waited','V5-child-zombie']:
    group=[x for x in S if x['stage']==stage];classified=[]
    for s in group:
        evidence=[x for x in wn if x['pid']==s['targetPid'] and x['atMonotonicNs']<=s['startMonotonicNs']]
        terminated=s['v2']['rc']==0 and s['v2']['exitAbstime']>0
        if terminated:assert evidence,'Nonzero exit counter must match an actual prior WNOWAIT observation for this controlled child'
        classified.append({'pid':s['targetPid'],'label':s['label'],'bsdBytes':s['bsd']['bytes'],'bsdErrno':s['bsd']['errno'],'bsdStatusRaw':s['bsd']['status'],'v2StartAbstime':s['v2']['startAbstime'],'v2ExitAbstime':s['v2']['exitAbstime'],'classification':'terminated-unreaped' if terminated else 'live-at-this-read','matchingWnowait':evidence,'ownRaw':own(s),'childRaw':child(s)})
    rows.append({'stage':stage,'targets':classified,'unreapedFrontierRaw':sum(x['ownRaw']+x['childRaw'] for x in classified),'actualLiveOnlyFrontierRaw':sum(x['ownRaw']+x['childRaw'] for x in classified if x['classification']=='live-at-this-read'),'unreapedFrontierSeconds':sum(x['ownRaw']+x['childRaw'] for x in classified)/scale,'actualLiveOnlyFrontierSeconds':sum(x['ownRaw']+x['childRaw'] for x in classified if x['classification']=='live-at-this-read')/scale})
p_after=sample('parent-after-nested-wait')
rows.append({'stage':'V5-parent-after-all-waited','unreapedFrontierRaw':own(p_after)+child(p_after),'actualLiveOnlyFrontierRaw':own(p_after)+child(p_after),'unreapedFrontierSeconds':(own(p_after)+child(p_after))/scale,'actualLiveOnlyFrontierSeconds':(own(p_after)+child(p_after))/scale})
# A controlled fast read did catch this daemon's terminal usage, but this event is
# tied to its explicit EXITING pipe message and is not a five-second guarantee.
d_first=sample('daemon-first-after-exiting-message');d_last=sample('daemon-final-api-read');d_live=sample('daemon-after-work');p_before=sample('parent-after-intermediate-wait');p_end=sample('parent-after-daemon-exit')
d_terminal=own(d_first)/scale if d_first['v2']['rc']==0 and d_first['v2']['exitAbstime']>0 else None
D={'actualNewParentPid':[x for x in E if x.get('kind')=='reparent-boundary'][0]['actualNewParentPid'],'liveOwnSeconds':own(d_live)/scale,'terminalCounterCaughtOnlyByExplicitExitMessageFastRead':d_terminal,'terminalCounterExitAbstime':d_first['v2']['exitAbstime'],'sameStartAbstimeAsLive':d_first['v2']['startAbstime']==d_live['v2']['startAbstime'],'controllerChildDeltaAfterIntermediateWaitSeconds':(child(p_end)-child(p_before))/scale,'laterApiUnavailable':d_last['v2']['rc']==-1 and d_last['v2']['errno']==3,'gapUntilFinalReadSeconds':(d_last['startMonotonicNs']-d_first['endMonotonicNs'])/1e9,'guaranteedFiveSecondCapture':False,'beforeExitSelfOracleNotUsedAsExactTerminalCpu':True}
out={'kind':'independent-existing-raw-scope-adjudication','originalJudgeSha256':hashlib.sha256((R/'judge.py').read_bytes()).hexdigest(),'originalResultSha256':hashlib.sha256((R/'result.json').read_bytes()).hexdigest(),'rawSha256':hashlib.sha256((R/'native-stdout.jsonl').read_bytes()).hexdigest(),'original13ChecksUnchanged':True,'descriptionCarrierCorrection':{'field':'observations.V5_nested.frontiers[*].selfPlusChildLiveOnlyRaw','problem':'Original descriptive calculation used BSD status!=SZOMB. This SDK returns BSD bytes0/errno3/status0 for an actual waitable zombie, so it misclassified the missing BSD status as live. No original success assertion or fullScope approval depended on that descriptive field.','correction':'Only existing WNOWAIT and successful v2 exitAbstime identify these controlled terminated-unreaped children. Keep raw status0; do not change it to5. Sum all unreaped frontier for transfer continuity; do not call that sum live-only.'},'unitScaleRawPerSecond':scale,'correctedNestedFrontiers':rows,'daemonBoundary':D,'scopeConclusions':{'directReapedChildrenSupportedForThisControlledTrace':True,'unreapedZombiesStillNeedAccounting':True,'nestedReapedSubtreeRollupSupportedForThisControlledTrace':True,'naiveLiveOnlyPlusParentChildIsNotAlwaysContinuous':True,'allOwnedForestIncludingReparentedDaemonAutomaticallyCovered':False,'futureScopeMustFailClosedOnUnresolvedTerminalOrOwnershipGap':True,'fullScopeAccountingApproved':False,'originalT111CpuThresholdPercentUnchanged':5,'originalT111003FailureUnchanged':True},'NativeReexecuted':False,'originalFilesChanged':False}
(R/'scope-adjudication.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'correctedFrontiers':[(x['stage'],x['unreapedFrontierSeconds'],x['actualLiveOnlyFrontierSeconds']) for x in rows],'daemon':D,'fullScopeApproved':False},indent=2))
