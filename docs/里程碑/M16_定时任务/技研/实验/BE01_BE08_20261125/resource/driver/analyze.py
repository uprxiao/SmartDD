#!/usr/bin/env python3
"""Offline verification and statistics for fixed-file BE08 technical-probe evidence."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import statistics
from PIL import Image


def load_json(path):
    return json.loads(path.read_text()) if path.exists() else None


def number(x):
    return type(x) in (int, float) and math.isfinite(x)


def assess_png(root, operation):
    result = {'ok': False}
    try:
        s = operation['capture']
        name = 'warmup' if operation['checkpoint'] == -1 else f"{operation['checkpoint']:02d}"
        expected_path = f"screenshots/{name}-page{operation['fixture']}.png"
        if s['file'] != expected_path:
            raise ValueError('unexpected capture path')
        target = root / expected_path
        if not target.resolve().is_relative_to(root):
            raise ValueError('capture path outside isolated root')
        data = target.read_bytes()
        if hashlib.sha256(data).hexdigest() != s['sha256'] or len(data) != s['bytes']:
            raise ValueError('capture bytes/hash mismatch')
        # Independent expected color from known click ledger (not driver marker).
        target_hex = ['e32636', '178847'][(operation['checkpoint'] + 1) % 2]
        target_rgb = tuple(bytes.fromhex(target_hex))
        with Image.open(target) as im:
            if im.format != 'PNG':
                raise ValueError('capture not PNG')
            image = im.convert('RGB')
        w, h = image.size
        if w < 440 or h < 300 or abs(w / h - 440 / 300) > .025:
            raise ValueError(f'wrong capture geometry {w}x{h}')
        # Sample 25 interior locations in the known marker. Allows device pixel
        # scaling / modest color-space conversion, rejects stale or black frames.
        pixels = [image.getpixel((round(x * w / 440), round(y * h / 300)))
                  for x in (260, 280, 300, 320, 340) for y in (180, 195, 210, 225, 240)]
        matching = sum(max(abs(a - b) for a, b in zip(pixel, target_rgb)) <= 42 for pixel in pixels)
        result.update(size=[w,h],expectedRGB=list(target_rgb),matchingMarkerPixels=matching,sampledPixels=len(pixels),
                      centerRGB=list(image.getpixel((round(300*w/440),round(207*h/300)))),ok=matching>=23)
    except (OSError, KeyError, ValueError, TypeError, IndexError) as e:
        result['error'] = str(e)
    return result


def topology_ok(t, mode):
    try:
        wcs=t['owned'];ids=[wc['contentsId'] for wc in wcs]
        return (t['baseWindowCount']==1 and t['browserWindowCount']==0 and t['hostVisible'] is False
                and t['hostFocused'] is False and not t['everFocused'] and not t['everShown']
                and len(wcs)==len(set(ids))==6 and set(ids)==set(t['appWebContentsIds'])
                and all(not wc['destroyed'] and type(wc['osProcessId']) is int and wc['osProcessId']>0 for wc in wcs)
                and t['layers']==['page0','page1','page2','page3','page4','shell']
                and set(wc['role'] for wc in wcs)=={'page0','page1','page2','page3','page4','shell'}
                and all(wc['viewVisible']==(mode=='keep' or wc['role']=='shell') for wc in wcs))
    except (TypeError,KeyError):
        return False


def point(row, mode):
    """Verify complete Electron association and return raw-point aggregates."""
    items=row['processes'];pids=[i['pid'] for i in items]
    ws=[p.get('memory',{}).get('workingSetSize') for p in items]
    identities=[(i['pid'],i.get('creationTime')) for i in items]
    expected=set(row['expectedPids']);extra_diagnostics=[]
    if not expected or not expected.issubset(pids) or row.get('missingExpectedPids'):
        extra_diagnostics.append('owned renderer/main PID missing in Electron process metrics')
    if (len(items)!=len(set(pids)) or not all(number(x[1]) for x in identities)
            or any(type(pid) is not int or pid<=0 for pid in pids)):
        extra_diagnostics.append('invalid PID/creationTime metric identity')
    if not all(number(v) and v>0 for v in ws) or not ws:
        extra_diagnostics.append('missing/zero process working set')
    if not topology_ok(row['topology'],mode):
        extra_diagnostics.append('unexpected host/page topology')
    if not any(p['pid']==row['mainPid'] and p['type']=='Browser' for p in items):
        extra_diagnostics.append('browser main process metric not observed')
    actual_expected={row['mainPid'],*(wc['osProcessId'] for wc in row['topology']['owned'])}
    if expected!=actual_expected:
        extra_diagnostics.append('expected PID ledger does not match owned shell/pages')
    percent=[p.get('cpu',{}).get('percentCPUUsage') for p in items]
    return dict(phase=row['phase'],checkpoint=row.get('checkpoint'),scheduledElapsedMs=row.get('scheduledElapsedMs'),
                actualElapsedMs=row.get('sampleElapsedMs'),sampledMonoMs=row['sampledMonoMs'],
                workingSetKiB=sum(ws) if ws and all(number(v) and v>=0 for v in ws) else None,
                processCount=len(items),processTypes=dict(Counter(p['type'] for p in items)),
                PIDCreationTime=[list(v) for v in identities],
                sumReportedCPUPercent=sum(percent) if percent and all(number(v) and v>=0 for v in percent) else None,
                complete=not extra_diagnostics,diagnostics=extra_diagnostics)


def idle_stats(rows, points):
    duration=0.0;valid_duration=0.0;cpu_seconds=0.0;raw_percent_seconds=0.0;raw_percent_duration=0.0
    gaps=[];intervals=[]
    for i in range(1,len(rows)):
        x,y=rows[i-1],rows[i];a,b=points[i-1],points[i]
        # Do not count a checkpoint-before -> checkpoint-after interval as idle.
        if x['phase'] not in ('checkpoint-after','idle') or y['phase'] not in ('idle','checkpoint-before'):
            continue
        sec=(y['sampledMonoMs']-x['sampledMonoMs'])/1000
        if sec<=0:
            gaps.append({'from':x.get('sampleElapsedMs'),'to':y.get('sampleElapsedMs'),'why':'invalid monotonic interval'})
            continue
        duration+=sec
        old={(p['pid'],p['creationTime']):p.get('cpu',{}).get('cumulativeCPUUsage') for p in x['processes'] if 'creationTime' in p}
        new={(p['pid'],p['creationTime']):p.get('cpu',{}).get('cumulativeCPUUsage') for p in y['processes'] if 'creationTime' in p}
        reason=None;diff=None
        if not (a['complete'] and b['complete']): reason='incomplete process/topology coverage'
        elif old.keys()!=new.keys(): reason='process identities changed; unknown CPU before first or after last sample'
        elif not old or not all(number(old[k]) and number(new[k]) and old[k]>=0 and new[k]>=old[k] for k in old): reason='cumulative process CPU time absent or reset'
        else:
            diff=sum(new[k]-old[k] for k in old);valid_duration+=sec;cpu_seconds+=diff
        if reason: gaps.append({'from':x.get('sampleElapsedMs'),'to':y.get('sampleElapsedMs'),'durationSec':sec,'why':reason})
        raw=b['sumReportedCPUPercent']
        if a['complete'] and b['complete'] and old.keys()==new.keys() and number(raw):
            raw_percent_duration+=sec;raw_percent_seconds+=sec*raw
        intervals.append({'fromElapsedMs':x.get('sampleElapsedMs'),'toElapsedMs':y.get('sampleElapsedMs'),'durationSec':sec,
                          'cumulativeCpuSecondsDelta':diff,'normalizedToOneLogicalCpuPercent':100*diff/sec if diff is not None else None})
    return dict(idleIntervalCount=len(intervals),possibleIdleSeconds=duration,cumulativeCpuCoveredSeconds=valid_duration,
                cumulativeCpuCoverageFraction=valid_duration/duration if duration else None,
                weightedIdleCPUPercentOfOneLogicalCPU=100*cpu_seconds/valid_duration if valid_duration else None,
                weightedMeanRawReportedPercent=raw_percent_seconds/raw_percent_duration if raw_percent_duration else None,
                rawReportedPercentCoveredSeconds=raw_percent_duration,gaps=gaps,intervals=intervals)


def analyze(root):
    manifest=load_json(root/'manifest.json') or {};launcher=load_json(root/'run-result.json') or {}
    rows=[];errors=[]
    if (root/'raw.jsonl').exists():
        for line_no,line in enumerate((root/'raw.jsonl').read_text().splitlines(),1):
            try: rows.append(json.loads(line))
            except json.JSONDecodeError as e: errors.append(f'malformed JSONL line {line_no}: {e}')
    else: errors.append('missing raw.jsonl (startup failure or not executed)')
    grouped={name:[row for row in rows if row.get('event')==name] for name in {row.get('event') for row in rows}}
    def one(name):
        items=grouped.get(name,[])
        if len(items)!=1: errors.append(f'expected one {name}, got {len(items)}')
        return items[-1] if items else {}
    env=one('environment');complete=one('complete');cleanup=one('cleanup');measurement=one('measurement-complete')
    mode=env.get('mode');length=env.get('length');checkpoint_ms=env.get('checkpointMs');sample_ms=env.get('sampleMs')
    if (mode not in ('keep','idle') or length not in ('short','long') or mode!=manifest.get('mode') or length!=manifest.get('length')
            or env.get('electron')!='42.11.14' or env.get('pageCount')!=5 or env.get('fixedLocalFixtureOnly') is not True
            or env.get('neverShowHost') is not True or env.get('backgroundThrottling') is not False):
        errors.append('unexpected trial manifest/environment')
    expected_intervals=(300000,5000) if length=='long' else (5000,1000)
    if (checkpoint_ms,sample_ms)!=expected_intervals:
        errors.append('unexpected checkpoint/sample interval')

    failing_events=[r for r in rows if r.get('event') in ('driver-error','startup-error','watchdog')]
    if failing_events: errors.append('driver/startup/watchdog failure present')
    if complete.get('success') is not True: errors.append('probe did not complete successfully')
    clean=(cleanup.get('allDestroyed') is True and cleanup.get('ownedCount')==6 and cleanup.get('windowDestroyed') is True
           and cleanup.get('remainingWindows')==0 and cleanup.get('remainingWebContents')==[] and cleanup.get('errors')==[]
           and launcher.get('exitCode')==0 and launcher.get('timeout') is False and launcher.get('forcedTermination')==[]
           and launcher.get('expectedProcessGroup')==launcher.get('observedProcessGroup') and launcher.get('expectedProcessGroup') is not None
           and launcher.get('processGroupMembersAfterExit')==[])
    if not clean: errors.append('normal private host/owned WebContents/process group cleanup not confirmed')
    if not topology_ok(measurement.get('topology'),mode): errors.append('measurement end topology invalid')
    if not number(measurement.get('activeElapsedMs')) or not number(checkpoint_ms) or measurement['activeElapsedMs']<6*checkpoint_ms:
        errors.append('planned real time duration not reached')

    operations=grouped.get('operation',[]);operation_results=[]
    identities={};last={};seen=Counter()
    for op in operations:
        case=(op.get('checkpoint'),op.get('fixture'));seen[case]+=1
        cp,page=case;defects=[]
        if type(cp) is not int or cp not in range(-1,7) or type(page) is not int or page not in range(5):
            errors.append(f'invalid operation case {case}');continue
        if op.get('success') is not True: defects.append('driver operation failure')
        expected_before=cp+1;expected_after=cp+2;expected_drawable=cp==-1 or mode=='keep'
        if (op.get('beforeDrawable') != expected_drawable or op.get('duringDrawable') is not True
                or op.get('afterDrawable') != expected_drawable or op.get('attachedAfter') is not False):
            defects.append('drawable/focus debugger cleanup state mismatch')
        before=op.get('before') or {};after=op.get('after') or {};final=op.get('finalState') or {}
        if (before.get('clicks'),after.get('clicks'),final.get('clicks'))!=(expected_before,expected_after,expected_after):
            defects.append('actual click state does not advance exactly once')
        identity=(op.get('contentsId'),op.get('osProcessId'),before.get('documentId'))
        if not all(v is not None for v in identity) or any(s.get('fixtureId')!=page or s.get('width')!=440 or s.get('height')!=300 or s.get('documentId')!=identity[-1] for s in (before,after,final)):
            defects.append('fixture identity/geometry changed')
        if page in identities and identities[page]!=identity: defects.append('WebContents/document/renderer changed between checkpoints')
        identities.setdefault(page,identity)
        rate=None
        if cp>=0:
            prev=last.get(page,{})
            if number(before.get('ticks')) and number(prev.get('ticks')) and number(before.get('performanceMs')) and number(prev.get('performanceMs')):
                dt=before['performanceMs']-prev['performanceMs'];delta=before['ticks']-prev['ticks']
                if delta!=op.get('idleTickDelta') or dt!=op.get('documentTimeDeltaMs'): defects.append('timer ledger mismatch')
                if dt>0 and delta>0: rate=1000*delta/dt
                else: defects.append('timer did not advance between operations')
            else: defects.append('timer continuity missing')
        last[page]=final
        png=assess_png(root,op)
        if not png['ok']: defects.append('screenshot marker/PNG integrity not verified')
        operation_results.append(dict(checkpoint=cp,page=page,ok=not defects,defects=defects,tickRateHz=rate,
                                      idleTickDelta=op.get('idleTickDelta'),durationMs=op.get('durationMs'),capture=png))
    wanted={(cp,page) for cp in range(-1,7) for page in range(5)}
    if set(seen)!=wanted or any(count!=1 for count in seen.values()): errors.append('operation case ledger not exactly 5 warmups + 35 checkpoint interactions')
    invalid_ops=[r for r in operation_results if not r['ok']]
    if invalid_ops: errors.append(f'{len(invalid_ops)} fixed-fixture operation receipts failed')

    starts=grouped.get('checkpoint-start',[]);ends=grouped.get('checkpoint-end',[])
    exact=lambda seq: len(seq)==7 and {r.get('checkpoint') for r in seq}==set(range(7))
    timing_ok=exact(starts) and exact(ends) and number(checkpoint_ms) and number(sample_ms)
    if timing_ok:
        tolerance=max(250,sample_ms/2)
        timing_ok=all(r.get('scheduledElapsedMs')==r['checkpoint']*checkpoint_ms and number(r.get('lateMs')) and r['lateMs']<=tolerance for r in starts)
        timing_ok=timing_ok and all(topology_ok(r.get('topology'),mode) for r in ends)
    if not timing_ok: errors.append('fixed checkpoint schedule or topology not confirmed')

    metrics=grouped.get('metric',[]);points=[];metric_shape=True
    for row in metrics:
        try: points.append(point(row,mode))
        except (KeyError,TypeError,ValueError) as e:
            errors.append(f'malformed metric row: {e}');metric_shape=False
    before_points=[p for p in points if p['phase']=='checkpoint-before'];after_points=[p for p in points if p['phase']=='checkpoint-after']
    scope_complete=metric_shape and bool(points) and all(p['complete'] for p in points) and exact(before_points) and exact(after_points)
    if not scope_complete: errors.append('Electron-associated process resource coverage incomplete')
    if not all(a['sampledMonoMs']<b['sampledMonoMs'] for a,b in zip(points,points[1:])):
        errors.append('nonmonotonic metric sample timestamps');scope_complete=False
    try: cpu=idle_stats(metrics,points) if metric_shape else None
    except (KeyError,ValueError,TypeError) as e:
        cpu=None;errors.append(f'CPU statistics malformed: {e}')
    cpu_complete=bool(cpu and number(cpu['cumulativeCpuCoverageFraction']) and cpu['cumulativeCpuCoverageFraction']>=.999999)
    skipped=grouped.get('skipped-sample',[])
    if not cpu_complete: errors.append('idle cumulative process CPU has unmeasured intervals; raw percent kept as diagnostic only')
    # Report scheduling gaps; distinguish legitimately skipped samples during
    # operation windows from delayed idle samples. Long average remains explicitly
    # weighted over observed stable identities; no imputation of disappeared CPU.
    pre=sorted(before_points,key=lambda r:r['checkpoint'])
    pre_values=[p['workingSetKiB'] for p in pre]
    rss_ratio=None;strict_increase_last4=None
    if len(pre_values)==7 and all(number(v) and v>0 for v in pre_values):
        rss_ratio=pre_values[6]/pre_values[2]
        strict_increase_last4=all(x<y for x,y in zip(pre_values[-4:],pre_values[-3:]))
    cpu_pct=cpu['weightedIdleCPUPercentOfOneLogicalCPU'] if cpu else None
    # Same trend-shape thresholds are reported diagnostically only for the 30min
    # synthetic run. Short checkpoints are seconds, and never T111 evidence.
    trend=None
    if length=='long' and scope_complete and timing_ok and rss_ratio is not None and cpu_complete:
        trend=dict(workingSet30to10Within110pct=rss_ratio<=1.10,lastFourWorkingSetsNotStrictlyGrowing=not strict_increase_last4,
                   idleCumulativeCPUPercentOfOneLogicalCpuBelow5=cpu_pct<5)
    rates=[r['tickRateHz'] for r in operation_results if number(r['tickRateHz'])]
    durations=[r['durationMs'] for r in operation_results if r['checkpoint']>=0 and number(r['durationMs'])]
    summary=dict(classification='synthetic technical probe only — not formal T111 or product E2E acceptance',root=str(root),
                 mode=mode,length=length,manifest=manifest,environment=env,launcher=launcher,probeEvidenceComplete=not errors,
                 errors=errors,driverFailureEvents=failing_events,normalCleanupConfirmed=clean,scheduledCheckpointCount=len(starts),
                 maxCheckpointLatenessMs=max((r['lateMs'] for r in starts if number(r.get('lateMs'))),default=None),scheduleConfirmed=timing_ok,
                 observedMeasurementMs=measurement.get('activeElapsedMs'),operationCount=len(operations),operationPassed=len(operation_results)-len(invalid_ops),
                 fixedFixtureOperationReceipts=operation_results,medianIdleFixtureTickRateHz=statistics.median(rates) if rates else None,
                 minIdleFixtureTickRateHz=min(rates,default=None),medianCheckpointPageOperationMs=statistics.median(durations) if durations else None,
                 resourceScopeComplete=scope_complete,resourceScope='all Electron-associated app.getAppMetrics processes at each sample, checked for main and six known renderer identities. No production helper/CLI/PTy or unreported external/reparented process coverage.',
                 memoryMeasure='sum of per-process workingSetSize (Electron KiB), possibly counts shared pages multiple times; not unique physical RAM or a system-wide footprint.',
                 checkpointBeforeWorkingSetKiB=pre_values,checkpointBeforePoints=pre,allMetricPointCount=len(points),
                 lastToThirdCheckpointWorkingSetRatio=rss_ratio,last4WorkingSetsStrictlyIncreasing=strict_increase_last4,
                 idleCPU=cpu,resourceSampleSkippedCount=len(skipped),resourceSampleSkipped=skipped,syntheticLongTrendChecks=trend,
                 blockedNetworkRequestCount=len(grouped.get('blocked-network-request',[])))
    (root/'resource-points.json').write_text(json.dumps(points,ensure_ascii=False,indent=2)+'\n')
    (root/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    return summary


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run_root',type=Path)
    args=parser.parse_args();root=args.run_root.resolve(strict=True)
    if not (root.parent==Path('/private/tmp') and root.name.startswith('willyou-f36-resource-run-')):
        parser.error('Expected isolated synthetic run root')
    result=analyze(root)
    print(json.dumps({k:result[k] for k in ('classification','mode','length','probeEvidenceComplete','errors','operationCount','operationPassed','normalCleanupConfirmed','resourceScopeComplete','checkpointBeforeWorkingSetKiB','lastToThirdCheckpointWorkingSetRatio','syntheticLongTrendChecks')},ensure_ascii=False,indent=2))
    raise SystemExit(0 if result['probeEvidenceComplete'] else 1)


if __name__=='__main__': main()
