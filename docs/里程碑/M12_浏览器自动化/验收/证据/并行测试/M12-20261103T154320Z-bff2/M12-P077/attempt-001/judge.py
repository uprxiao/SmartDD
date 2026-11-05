from pathlib import Path
import json,hashlib
root=Path(__file__).parent
raw=json.loads((root/'raw.json').read_text())
summaries=[]
for phase in raw.get('phases',[]):
    rows=phase['samples'];intervals=[]
    for a,b in zip(rows,rows[1:]):
        dt=(b['monotonicNs']-a['monotonicNs'])/1e9
        previous={x['identity']:x for x in a['processes']};current={x['identity']:x for x in b['processes']}
        gaps=sorted(set(previous)^set(current));common=set(previous)&set(current)
        by_pid=[{'pid':current[k]['pid'],'name':current[k]['name'],'cpuSecondsDelta':current[k]['cpuSeconds']-previous[k]['cpuSeconds']} for k in common]
        total=sum(x['cpuSecondsDelta'] for x in by_pid)
        intervals.append({'seconds':dt,'oneCorePercent':total/dt*100 if dt>0 else None,'complete':not gaps and not a['readErrors'] and not b['readErrors'] and all(x['cpuSecondsDelta']>=0 for x in by_pid),'identityGaps':gaps,'byProcess':by_pid})
    complete=[x for x in intervals if x['complete']]
    seconds=sum(x['seconds']for x in complete)
    summaries.append({'label':phase['label'],'actualSeconds':phase.get('actualSeconds'),'weightedAggregateOneCorePercent':sum(sum(p['cpuSecondsDelta']for p in x['byProcess'])for x in complete)/seconds*100 if seconds else None,'weightedMainOneCorePercent':sum(sum(p['cpuSecondsDelta']for p in x['byProcess']if p['pid']==raw['appPid'])for x in complete)/seconds*100 if seconds else None,'completeIdleSeconds':seconds,'allIntervalsComplete':len(complete)==len(intervals),'rssBeforeBytes':rows[0]['rssTotalBytes'],'rssAfterBytes':rows[-1]['rssTotalBytes'],'intervals':intervals})
profile_path=root/'main.cpuprofile';profile_analysis=None
if profile_path.exists():
    profile=json.loads(profile_path.read_text());nodes={n['id']:n for n in profile['nodes']};parents={child:n['id']for n in profile['nodes']for child in n.get('children',[])};self_time={};inclusive_time={}
    for ident,delta in zip(profile.get('samples',[]),profile.get('timeDeltas',[])):
        self_time[ident]=self_time.get(ident,0)+delta
        seen=set()
        while ident in nodes and ident not in seen:
            seen.add(ident);inclusive_time[ident]=inclusive_time.get(ident,0)+delta;ident=parents.get(ident)
    def top(values):
        return [{'nodeId':i,'microseconds':v,'callFrame':nodes[i]['callFrame']}for i,v in sorted(values.items(),key=lambda item:-item[1])[:40]]
    profile_analysis={'sha256':hashlib.sha256(profile_path.read_bytes()).hexdigest(),'durationMicroseconds':profile['endTime']-profile['startTime'],'sampleCount':len(profile.get('samples',[])),'timeDeltaCount':len(profile.get('timeDeltas',[])),'totalSampleTimeMicroseconds':sum(profile.get('timeDeltas',[])),'topSelf':top(self_time),'topInclusive':top(inclusive_time),'boundary':'Profiler sampling overhead isolated. Inclusive times overlap by ancestry and must not be summed. Node stacks do not measure total native/child CPU. Minified bundled frames require exact source017/App018 source map correlation; no invented source line.'}
    (root/'profile-analysis.json').write_text(json.dumps(profile_analysis,indent=2)+'\n')
out={'diagnosticOnly':True,'formalCaseIncrement':0,'status':'diagnostic-data-recorded'if raw.get('status')=='diagnostic-executed-unjudged' else'partial-diagnostic','phases':summaries,'profile':profile_analysis,'originalT111CriteriaChanged':False,'normalExit':raw.get('normalExit'),'cleanupErrors':raw.get('cleanupErrors'),'boundary':'No original case pass; compare phases as measured, do not subtract active-run baseline from formal T111 or declare causal proof solely from phase difference.'}
(root/'result.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'status':out['status'],'phases':[(x['label'],x['weightedAggregateOneCorePercent'],x['weightedMainOneCorePercent'])for x in summaries],'profileRecorded':profile_analysis is not None}))
