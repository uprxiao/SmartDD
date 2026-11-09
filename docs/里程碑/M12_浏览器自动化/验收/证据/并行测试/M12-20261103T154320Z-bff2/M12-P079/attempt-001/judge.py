#!/usr/bin/env python3
"""Pure-data independent characterization, never runs a process/API or changes raw."""
import json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def load(path,default=None):
    p=ROOT/path
    return json.loads(p.read_text()) if p.is_file() else default

def main():
    events=[];parse_errors=[]
    p=ROOT/'native-stdout.jsonl'
    if p.is_file():
        for line_no,line in enumerate(p.read_text(errors='replace').splitlines(),1):
            try:events.append(json.loads(line))
            except Exception as exc:parse_errors.append({'line':line_no,'error':str(exc)})
    execution=load('execution.json',{});cleanup=load('cleanup.json',{})
    snapshots=[e for e in events if e.get('kind')=='snapshot'];waits=[e for e in events if e.get('kind')=='wait4']
    def snap(label):
        found=[e for e in snapshots if e['label']==label]
        if len(found)!=1:raise ValueError('Expected unique snapshot '+label+', got '+str(len(found)))
        return found[0]
    def wait(label):
        found=[e for e in waits if e['label']==label]
        if len(found)!=1:raise ValueError('Expected unique wait4 '+label)
        return found[0]
    def total(s,field='self',version='v2'):
        value=s[version]
        if value['rc']!=0:raise ValueError('Unavailable '+version+' counter at '+s['label'])
        return value['user']+value['system'] if field=='self' else value['childUser']+value['childSystem']
    def ref(s,field='self'):
        r=s['readerReference'];return (r['selfUserUs']+r['selfSystemUs']) if field=='self' else (r['childrenUserUs']+r['childrenSystemUs'])
    def wait_us(w):return w['userUs']+w['systemUs']
    # Tolerance below compares short controlled counters across non-atomic reads only.
    # It never modifies the original App CPU<5% or hides idle peaks.
    def near(actual,expected):return abs(actual-expected)<=max(.004,abs(expected)*.035)
    checks=[]
    def check(name,ok,detail):checks.append({'id':name,'passed':bool(ok),'detail':detail})
    check('RAW-JSON',not parse_errors,parse_errors)
    check('COMPILE',execution.get('compiler',{}).get('returnCode')==0,execution.get('compiler',{}))
    check('NATIVE-EXIT',execution.get('probe',{}).get('returnCode')==0 and not execution.get('probe',{}).get('terminationByRunner',True),execution.get('probe',{}))
    complete=[e for e in events if e.get('kind')=='complete']
    errors=[e for e in events if e.get('kind')=='error']
    check('SIX-PHASE-COMPLETE',len(complete)==1 and complete[0].get('cases')==6 and not errors,{'complete':complete,'errors':errors})
    check('EXACT-CLEANUP',cleanup.get('exactOwnedIdentitiesClear') is True and not cleanup.get('errors'),cleanup)
    observations={};unit=None
    try:
        before=snap('self-before-work');after=snap('self-after-work')
        if any(s['readerReference']['selfRc']!=0 or s['readerReference']['childrenRc']!=0 for s in [before,after]):raise ValueError('getrusage unit reference failed')
        ref_delta_us=ref(after)-ref(before);delta=total(after)-total(before)
        abi=[e for e in events if e.get('kind')=='abi']
        check('ABI-AND-V1-V2',len(abi)==1 and abi[0]['v1ChildUserOffset']==abi[0]['v2ChildUserOffset'] and all(s[v]['rc']==0 for s in snapshots if s['bsd']['bytes']==abi[0]['bsdInfoSize'] and s['bsd']['status']!=abi[0]['zombieConstant'] for v in ['v1','v2']),abi)
        candidates=[('nanoseconds',1e9),('microseconds',1e6)]
        if abi and abi[0]['timebaseRc']==0 and abi[0]['timebaseNumer']>0:
            candidates.append(('mach-absolute-ticks',1e9*abi[0]['timebaseDenom']/abi[0]['timebaseNumer']))
        fits=[{'name':name,'rawUnitsPerSecond':scale,'measuredSeconds':delta/scale,'referenceSeconds':ref_delta_us/1e6} for name,scale in candidates if ref_delta_us>50000 and near(delta/scale,ref_delta_us/1e6)]
        scales={round(x['rawUnitsPerSecond'],6) for x in fits}
        if len(scales)==1:unit=fits[0]['rawUnitsPerSecond']
        observations['unitCalibration']={'rawOwnDelta':delta,'referenceOwnDeltaUs':ref_delta_us,'compatibleCandidates':fits,'uniqueScaleEstablished':unit is not None,'note':'Equivalent numeric Mach/nanosecond scales may remain named ambiguously; no API unit claim beyond the observed scale.'}
        check('SELF-UNIT-CALIBRATION',unit is not None,observations['unitCalibration'])
        if unit is None:raise ValueError('No unambiguous raw-to-seconds scale; child semantics remain uninterpretable')
        v1_agreement=[]
        for s in snapshots:
            if s['v1']['rc']==0 and s['v2']['rc']==0:
                v1_agreement.append({'label':s['label'],'selfDifferenceSeconds':abs(total(s,version='v1')-total(s))/unit,'childDifferenceSeconds':abs(total(s,'child','v1')-total(s,'child'))/unit})
        check('V1-V2-AGREEMENT',bool(v1_agreement) and all(x['selfDifferenceSeconds']<.004 and x['childDifferenceSeconds']<.004 for x in v1_agreement),v1_agreement)
        p0=snap('parent-before-child');alive=snap('parent-child-alive');zombie=snap('parent-zombie-unwaited');waited=snap('parent-after-child-wait');child=snap('child-alive');w=wait('direct-child-waited')
        stage={'liveChildOwnSeconds':total(child)/unit,'parentChildDeltaWhileLive':(total(alive,'child')-total(p0,'child'))/unit,'parentChildDeltaAtZombieBeforeWait':(total(zombie,'child')-total(alive,'child'))/unit,'parentChildDeltaAtWait':(total(waited,'child')-total(zombie,'child'))/unit,'parentChildWholeDelta':(total(waited,'child')-total(p0,'child'))/unit,'parentGetrusageChildrenWholeDeltaSeconds':(ref(waited,'child')-ref(p0,'child'))/1e6,'wait4Seconds':wait_us(w)/1e6,'zombieTargetRead':snap('child-zombie-unwaited')}
        stage['liveIncludedAccordingToObservedDelta']=stage['parentChildDeltaWhileLive']>.004
        stage['exitBeforeWaitIncludedAccordingToObservedDelta']=stage['parentChildDeltaAtZombieBeforeWait']>.004
        stage['waitCausedRollupAccordingToObservedDelta']=stage['parentChildDeltaAtWait']>.004
        stage['wholeRollupMatchesWait4']=near(stage['parentChildWholeDelta'],stage['wait4Seconds'])
        stage['wholeRollupMatchesParentGetrusageChildren']=near(stage['parentChildWholeDelta'],stage['parentGetrusageChildrenWholeDeltaSeconds'])
        observations['V2_V3_V4_directChild']=stage
        check('DIRECT-CHILD-ROLLUP-REFERENCE',stage['wholeRollupMatchesWait4'] and stage['wholeRollupMatchesParentGetrusageChildren'],stage)
        h0=snap('parent-before-hidden-child');h1=snap('parent-after-hidden-child');hw=wait('hidden-child-waited')
        hidden={'targetPid':hw['pid'],'parentDeltaSeconds':(total(h1,'child')-total(h0,'child'))/unit,'wait4Seconds':wait_us(hw)/1e6,'elapsedBoundarySeconds':(h1['endMonotonicNs']-h0['startMonotonicNs'])/1e9,'targetCpuSnapshotsBetweenBoundaries':[s['label'] for s in snapshots if s['targetPid']==hw['pid']],'note':'Identity and child self-rusage oracle are intentionally retained; the scheduled target CPU reader never samples this hidden child.'}
        hidden['referenceMatches']=near(hidden['parentDeltaSeconds'],hidden['wait4Seconds'])
        observations['V4_hiddenChild']=hidden
        check('HIDDEN-CHILD-REFERENCE',hidden['referenceMatches'] and not hidden['targetCpuSnapshotsBetweenBoundaries'] and hidden['elapsedBoundarySeconds']<5,hidden)
        n0=snap('parent-before-nested');n1=snap('parent-after-nested-wait');nw=wait('nested-child-waited-by-controller');gw=wait('grandchild-waited-by-child')
        nested={'parentChildDeltaSeconds':(total(n1,'child')-total(n0,'child'))/unit,'controllerWait4NestedSubtreeSeconds':wait_us(nw)/1e6,'childWait4GrandchildSeconds':wait_us(gw)/1e6,'frontiers':[]}
        for stage_name in ['V5-live','V5-grand-zombie','V5-grand-waited','V5-child-zombie']:
            group=[s for s in snapshots if s['stage']==stage_name]
            all_valid=all(s['v2']['rc']==0 for s in group)
            value={'stage':stage_name,'targets':[{'pid':s['targetPid'],'status':s['bsd']['status'],'v2rc':s['v2']['rc']} for s in group],'allCountersAvailable':all_valid}
            if all_valid:
                z=abi[0]['zombieConstant']
                value['selfPlusChildAllUnreapedRaw']=sum(total(s)+total(s,'child') for s in group)
                value['selfPlusChildLiveOnlyRaw']=sum(total(s)+total(s,'child') for s in group if s['bsd']['status']!=z)
                value['readSpanSeconds']=(max(s['endMonotonicNs'] for s in group)-min(s['startMonotonicNs'] for s in group))/1e9
            nested['frontiers'].append(value)
        nested['recursiveRollupMatchesWait4']=near(nested['parentChildDeltaSeconds'],nested['controllerWait4NestedSubtreeSeconds'])
        nested['grandchildNotAbsentFromSubtreeReference']=nested['controllerWait4NestedSubtreeSeconds']>=nested['childWait4GrandchildSeconds']-.004
        observations['V5_nested']=nested
        check('NESTED-ROLLUP-REFERENCE',nested['recursiveRollupMatchesWait4'] and nested['grandchildNotAbsentFromSubtreeReference'],nested)
        rep=[e for e in events if e.get('kind')=='reparent-boundary'];terminal=[e for e in events if e.get('kind')=='daemon-terminal-boundary']
        daemon_live=snap('daemon-after-work');p_after_m=snap('parent-after-intermediate-wait');p_final=snap('parent-after-daemon-exit');d_last=snap('daemon-final-api-read')
        reparent={'actualBoundary':rep,'terminalBoundary':terminal,'knownAliveDaemonOwnSecondsAfterReparent':total(daemon_live)/unit,'parentChildDeltaAfterIntermediateWaitSeconds':(total(p_final,'child')-total(p_after_m,'child'))/unit,'finalTargetApi':{'v1':d_last['v1'],'v2':d_last['v2'],'bsd':d_last['bsd']},'daemonSelfBeforeExitIsNotExactTerminalUsage':True,'guaranteedFutureFiveSecondTerminalCapture':False,'note':'A single successful zombie read or before-exit self report cannot guarantee all future reparented terminal CPU. No ledger/full-scope proof is inferred here.'}
        observations['V6_reparent']=reparent
        check('REPARENT-ACTUALLY-EXERCISED',len(rep)==1 and rep[0].get('changed') is True and len(terminal)==1 and terminal[0].get('originalIdentityNoLongerPresent') is True,reparent)
    except Exception as exc:checks.append({'id':'CHARACTERIZATION-CARRIER','passed':False,'detail':{'kind':type(exc).__name__,'message':str(exc)}})
    no_cleanup_kills=not any(e.get('kind')=='cleanup-target' and (e.get('sentTerm') or e.get('sentKill')) for e in events)
    check('NORMAL-CONTROLLED-EXIT-NO-FALLBACK',no_cleanup_kills and not execution.get('errors'),{'runnerErrors':execution.get('errors',[]),'normalCleanupNoSignals':no_cleanup_kills})
    out={'kind':'independent-controlled-rusage-characterization','checks':checks,'allControlledChecksPassed':bool(checks) and all(x['passed'] for x in checks),'observations':observations,'fullAppLifetimeScopeAccountingApproved':False,'productionSamplerChanged':False,'originalT111FormalPassClaim':False,'originalCpuPercentCriterion':5,'futureGate':'Characterization only. Review exact rollup/frontier/reparent semantics and implement/test a complete accounting ledger before allowing a future <5% full-scope pass. All original raw/curves/activity/peaks remain.'}
    out['status']='controlled-characterization-completed-scope-not-approved' if out['allControlledChecksPassed'] else 'controlled-characterization-failed-or-incomplete'
    (ROOT/'result.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'status':out['status'],'checks':len(checks),'passed':sum(x['passed'] for x in checks),'fullScopeApproved':False}))
    return 0 if out['allControlledChecksPassed'] else 1
if __name__=='__main__':raise SystemExit(main())
