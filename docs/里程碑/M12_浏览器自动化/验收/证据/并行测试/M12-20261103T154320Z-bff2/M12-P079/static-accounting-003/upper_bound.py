"""Pure-data conservative CPU upper model. No Native calls or production writes.
Scope proof is separate from arithmetic; absent evidence never becomes zero.
"""
from fractions import Fraction

REQUIRED_PROOFS=(
 'source_and_binary_pins',
 'five_snapshot_only_real_cli_workload',
 'baseline_owned_inventory_complete',
 'retained_roots_same_birth_through_final_cut',
 'hidden_transients_are_waited_leaf_subtrees_of_retained_roots',
 'no_unaccounted_orphan_or_reparent_exit',
 'final_unreaped_family_inventory_complete',
 'final_scan_races_closed_or_accounted',
 'native_units_and_counter_semantics_verified',
 'original_idle_denominator_and_peaks_retained',
)

def evaluate(data):
    gaps=[];credits={};previous={};seen_anchors={}
    if data.get('thresholdPercent')!=5:gaps.append('original-threshold-not-exactly-5')
    denominator=Fraction(str(data.get('originalIdleSeconds',0)))
    duration=Fraction(str(data.get('originalMeasurementSeconds',0)))
    if denominator<=0 or duration<1800 or denominator>duration:gaps.append('original-duration-or-idle-denominator-invalid')
    numerator=int(data.get('timebaseNumerator',0));divisor=int(data.get('timebaseDenominator',0))
    if numerator<=0 or divisor<=0:gaps.append('actual-native-timebase-unavailable')
    anchors=set(data.get('retainedAnchorIdentities',[]))
    if not anchors:gaps.append('no-retained-anchor-inventory')
    for index,sample in enumerate(data.get('samples',[])):
        present=set()
        for row in sample.get('processes',[]):
            identity=row.get('identity');role=row.get('role');raw=row.get('rusage',{})
            if not identity or raw.get('rc')!=0:
                gaps.append('unreadable-owned-counter:%s:%s'%(index,identity));continue
            own=int(raw['user'])+int(raw['system']);child=int(raw['childUser'])+int(raw['childSystem'])
            if min(own,child)<0:gaps.append('negative-raw-counter:%s'%identity)
            if identity in previous and (own<previous[identity][0] or child<previous[identity][1]):gaps.append('counter-decreased:%s'%identity)
            previous[identity]=(own,child)
            # Deliberately keep full lifetime maxima, including warm and busy work.
            # Retain credit after observed exit; later ancestor rollup may charge it again.
            old=credits.get(identity,(0,0));credits[identity]=(max(old[0],own),max(old[1],child))
            if identity in anchors:
                present.add(identity)
                start=int(raw.get('startAbstime',0))
                if not start:gaps.append('anchor-start-identity-unavailable:%s'%identity)
                if identity in seen_anchors and seen_anchors[identity]!=start:gaps.append('anchor-start-identity-changed:%s'%identity)
                seen_anchors[identity]=start
                if int(raw.get('exitAbstime',0))!=0:gaps.append('retained-anchor-terminated:%s'%identity)
            if role=='unknown-orphan' or row.get('unclosedTerminalGap'):gaps.append('unaccounted-orphan-or-terminal-gap:%s'%identity)
        if anchors-present:gaps.append('retained-anchor-missing:%s:%s'%(index,','.join(sorted(anchors-present))))
        if sample.get('coverageErrors'):gaps.extend('sample-coverage-error:'+str(x) for x in sample['coverageErrors'])
    if not data.get('samples'):gaps.append('no-samples')
    proofs=data.get('scopeProofs',{})
    for name in REQUIRED_PROOFS:
        proof=proofs.get(name,{})
        if proof.get('status')!='verified' or not proof.get('evidenceSha256') or not proof.get('actualRawReference'):
            gaps.append('unproved:'+name)
    raw_sum=sum(a+b for a,b in credits.values())
    seconds=Fraction(raw_sum*numerator,divisor*1000000000) if numerator>0 and divisor>0 else None
    upper=seconds*100/denominator if seconds is not None and denominator>0 else None
    lower=Fraction(str(data.get('originalObservedOwnPercent',0)))
    if lower>5:decision='original-observed-own-cpu-already-fails'
    elif gaps:decision='coverage-incomplete-no-full-scope-pass'
    elif upper is not None and upper<5:decision='arithmetic-would-support-original-cpu-mean-only-pending-coordinator-review'
    else:decision='conservative-upper-not-below-five-inconclusive-unless-lower-already-fails'
    return {'kind':'static-conservative-model-not-App-acceptance','upperLifetimeOwnPlusReapedRaw':raw_sum,'upperLifetimeCpuSeconds':float(seconds) if seconds is not None else None,'originalIdleSecondsUnchanged':float(denominator),'upperOneCorePercentExact':str(upper) if upper is not None else None,'upperOneCorePercent':float(upper) if upper is not None else None,'originalObservedOwnPercent':float(lower),'creditByIdentity':{k:{'maxOwnRaw':a,'maxReapedChildrenRaw':b} for k,(a,b) in credits.items()},'gaps':sorted(set(gaps)),'decision':decision,'formalFullScopeApproved':False,'originalCasePassed':False,'boundary':'Full lifetimes, warm/busy CPU and duplicate ancestor rollup intentionally overcharged. Arithmetic is an upper bound only after every external scope proof is independently established; no claim from sum growth alone.'}
