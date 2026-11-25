#!/usr/bin/env python3
"""Fabricated data unit tests for offline analyzer only; NO Electron / real measurements."""
from pathlib import Path
import hashlib
import json
import tempfile
from PIL import Image, ImageDraw
from analyze import analyze


def write_data(root, mode):
    root.mkdir(parents=True,exist_ok=True);(root/'screenshots').mkdir(exist_ok=True)
    (root/'manifest.json').write_text(json.dumps(dict(mode=mode,length='long',classification='FAKE ANALYZER UNIT FIXTURE; NO APP')))
    (root/'run-result.json').write_text(json.dumps(dict(exitCode=0,timeout=False,forcedTermination=[],expectedProcessGroup=901,observedProcessGroup=901,processGroupMembersAfterExit=[])))
    pages=[dict(role=f'page{i}',viewVisible=mode=='keep',destroyed=False,contentsId=i+1,osProcessId=911+i) for i in range(5)]
    pages.append(dict(role='shell',viewVisible=True,destroyed=False,contentsId=6,osProcessId=916))
    topology=dict(baseWindowCount=1,browserWindowCount=0,hostVisible=False,hostFocused=False,everFocused=False,everShown=False,owned=pages,appWebContentsIds=list(range(1,7)),layers=[f'page{i}' for i in range(5)]+['shell'])
    rows=[];pids=[901,*range(911,917),920];previous={}
    def rec(event,**kw): rows.append(dict(event=event,**kw))
    def metric(cp,phase,ms):
        processes=[dict(pid=pid,creationTime=100000+pid,type='Browser' if pid==901 else 'Utility' if pid==920 else 'Tab',memory=dict(workingSetSize=100),cpu=dict(cumulativeCPUUsage=ms/1000000,percentCPUUsage=.1)) for pid in pids]
        rec('metric',phase=phase,checkpoint=cp,scheduledElapsedMs=cp*300000 if cp is not None else None,sampledMonoMs=1000+ms,sampleElapsedMs=ms,mainPid=901,expectedPids=pids[:-1],missingExpectedPids=[],topology=topology,processes=processes)
    rec('environment',mode=mode,length='long',electron='42.11.14',pageCount=5,fixedLocalFixtureOnly=True,neverShowHost=True,backgroundThrottling=False,checkpointMs=300000,sampleMs=5000)
    def operation(cp,i):
        before_tick=int((cp+1)*3000)+10+i
        before=dict(fixtureId=i,documentId=f'fixture{i}',clicks=cp+1,ticks=before_tick,performanceMs=(cp+1)*300000+100+i,width=440,height=300)
        after={**before,'clicks':cp+2,'ticks':before_tick+1,'performanceMs':before['performanceMs']+100}
        final={**after,'ticks':before_tick+2,'performanceMs':before['performanceMs']+200}
        name='warmup' if cp==-1 else f'{cp:02d}'
        pic=root/'screenshots'/f'{name}-page{i}.png'
        marker=['#e32636','#178847'][(cp+1)%2]
        im=Image.new('RGB',(440,300),'#a8a8a8');ImageDraw.Draw(im).rectangle((240,160,359,254),fill=marker);im.save(pic)
        expected_visible=cp==-1 or mode=='keep';old=previous.get(i)
        fields=dict(checkpoint=cp,fixture=i,contentsId=i+1,osProcessId=911+i,beforeDrawable=expected_visible,duringDrawable=True,afterDrawable=expected_visible,attachedAfter=False,before=before,after=after,finalState=final,success=True,durationMs=120,capture=dict(file=str(pic.relative_to(root)),sha256=hashlib.sha256(pic.read_bytes()).hexdigest(),bytes=pic.stat().st_size,expectedMarker=marker))
        if old: fields.update(idleTickDelta=before['ticks']-old['ticks'],documentTimeDeltaMs=before['performanceMs']-old['performanceMs'])
        previous[i]=final;rec('operation',**fields)
    for i in range(5):operation(-1,i)
    for cp in range(7):
        ms=cp*300000
        metric(cp,'checkpoint-before',ms)
        rec('checkpoint-start',checkpoint=cp,scheduledElapsedMs=ms,lateMs=1)
        for i in range(5):operation(cp,i)
        rec('checkpoint-end',checkpoint=cp,topology=topology)
        metric(cp,'checkpoint-after',ms+800)
        if cp<6: metric(None,'idle',ms+150000)
    rec('measurement-complete',activeElapsedMs=1801000,topology=topology)
    rec('cleanup',allDestroyed=True,ownedCount=6,windowDestroyed=True,remainingWindows=0,remainingWebContents=[],errors=[])
    rec('complete',success=True)
    return rows


def write_rows(root, rows):
    (root/'raw.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))


def main():
    # Deliberately nested under private driver directory: not a valid actual run
    # root. Do not confuse these fabricated ledgers with experimental evidence.
    root=Path(tempfile.mkdtemp(prefix='analyzer-unit-only-',dir=Path(__file__).resolve().parent))
    cases=[]
    for mode in ('keep','idle'):
        test=root/mode;rows=write_data(test,mode);write_rows(test,rows)
        s=analyze(test);assert s['probeEvidenceComplete'],s['errors'];assert s['operationPassed']==40
        assert all(s['syntheticLongTrendChecks'].values());cases.append(f'{mode}: fabricated positive ledger accepted')
        op=next(r for r in rows if r['event']=='operation' and r['checkpoint']==4 and r['fixture']==2)
        target=test/op['capture']['file']
        im=Image.new('RGB',(440,300),'#a8a8a8');ImageDraw.Draw(im).rectangle((240,160,359,254),fill='#e32636');im.save(target)
        op['capture']['sha256']=hashlib.sha256(target.read_bytes()).hexdigest();op['capture']['bytes']=target.stat().st_size
        write_rows(test,rows);s=analyze(test);assert not s['probeEvidenceComplete'];assert s['operationPassed']==39;cases.append(f'{mode}: stale screenshot rejected despite valid hash')
    test=root/'coverage';rows=write_data(test,'idle')
    metric=next(r for r in rows if r['event']=='metric' and r['phase']=='idle')
    metric['processes']=[p for p in metric['processes'] if p['pid']!=911]
    write_rows(test,rows);s=analyze(test);assert not s['probeEvidenceComplete'];assert not s['resourceScopeComplete'];assert s['idleCPU']['cumulativeCpuCoverageFraction']<1;cases.append('missing owned renderer and incomplete CPU intervals rejected')
    test=root/'churn';rows=write_data(test,'keep')
    metric=next(r for r in rows if r['event']=='metric' and r['phase']=='idle')
    next(p for p in metric['processes'] if p['pid']==920)['creationTime']+=777
    write_rows(test,rows);s=analyze(test);assert not s['probeEvidenceComplete'];assert s['resourceScopeComplete'];assert s['idleCPU']['cumulativeCpuCoverageFraction']<1;cases.append('reused PID/changed creation time cannot count cumulative CPU interval')
    receipt={'kind':'offline analyzer unit tests with fabricated ledgers and PNGs ONLY; never BE08 runtime evidence','cases':cases,'passed':len(cases),'fabricatedRoot':str(root)}
    (root/'unit-test-result.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))


if __name__=='__main__':main()
