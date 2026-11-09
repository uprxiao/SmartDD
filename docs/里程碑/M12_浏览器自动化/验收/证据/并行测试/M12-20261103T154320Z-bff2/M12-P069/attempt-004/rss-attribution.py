"""Bounded read-only attribution of existing T111 raw RSS; no OS/native APIs."""
import json
from pathlib import Path

r=Path(__file__).parent
raw=json.loads((r/'raw.json').read_text())
milestones={x['minute']:x for x in raw['milestones']}
points=[json.loads(s) for s in (r/'resource-samples.jsonl').read_text().splitlines()]
points=[x for x in points if x.get('elapsedSeconds') is not None and x['kind']!='cleanup-observation']
maps={m:{x['identity']:x for x in milestones[m]['before']['processes']} for m in [15,20,25,30]}
first_set=set(maps[15])
assert all(set(x)==first_set for x in maps.values())
rows=[]
for ident in sorted(first_set):
    first=maps[15][ident];values={str(m):maps[m][ident]['rssBytes'] for m in maps}
    assert all(maps[m][ident]['pid']==first['pid'] and maps[m][ident]['createdAtEpochSeconds']==first['createdAtEpochSeconds'] and maps[m][ident]['executable']==first['executable'] for m in maps)
    phases=[]
    for m in [15,20,25,30]:
        before={x['identity']:x for x in milestones[m]['before']['processes']}[ident]
        after={x['identity']:x for x in milestones[m]['after']['processes']}[ident]
        assert (after['pid'],after['createdAtEpochSeconds'],after['executable'])==(first['pid'],first['createdAtEpochSeconds'],first['executable'])
        phases.append({'minute':m,'beforeRssBytes':before['rssBytes'],'afterRssBytes':after['rssBytes'],'commandBatchDeltaBytes':after['rssBytes']-before['rssBytes'],'nextBeforeDeltaAfterBatchBytes':maps[m+5][ident]['rssBytes']-after['rssBytes'] if m<30 else None})
    observed=[]
    for point in points:
        if point['elapsedSeconds']<milestones[15]['before']['elapsedSeconds']:continue
        entry=next((x for x in point['processes'] if x['identity']==ident),None)
        if entry:observed.append({'elapsedSeconds':point['elapsedSeconds'],'kind':point['kind'],'rssBytes':entry['rssBytes']})
    drops=[{'from':a,'to':b,'deltaBytes':b['rssBytes']-a['rssBytes']} for a,b in zip(observed,observed[1:]) if b['rssBytes']<a['rssBytes']]
    rows.append({'identity':ident,'pid':first['pid'],'birthEpochSeconds':first['createdAtEpochSeconds'],'executable':first['executable'],'name':first['name'],'ownership':first['ownership'],'rssBytesByOriginalMilestone':values,'net15to30Bytes':values['30']-values['15'],'commandPhases':phases,'observedLast15Minutes':{'points':len(observed),'minRssBytes':min(x['rssBytes'] for x in observed),'maxRssBytes':max(x['rssBytes'] for x in observed),'downwardSteps':len(drops),'largestDownwardStep':min(drops,key=lambda x:x['deltaBytes']) if drops else None},'gcEventsCaptured':False})
rows.sort(key=lambda x:x['net15to30Bytes'],reverse=True)
totals={str(m):sum(x['rssBytes'] for x in maps[m].values()) for m in maps}
assert sum(x['net15to30Bytes'] for x in rows)==totals['30']-totals['15']
total_drops=[]
last_points=[x for x in points if x['elapsedSeconds']>=milestones[15]['before']['elapsedSeconds']]
for a,b in zip(last_points,last_points[1:]):
    if b['rssTotalBytes']<a['rssTotalBytes']:total_drops.append({'fromElapsed':a['elapsedSeconds'],'toElapsed':b['elapsedSeconds'],'deltaBytes':b['rssTotalBytes']-a['rssTotalBytes'],'fromKind':a['kind'],'toKind':b['kind']})
result={'kind':'existing-raw-RSS-attribution','nativeExecuted':False,'originalCriterionChanged':False,'allMilestoneIdentityBirthPathsMatch':True,'originalMilestoneTotals':totals,'sumNet15to30Bytes':sum(x['net15to30Bytes'] for x in rows),'observedAggregateDownwardSteps':len(total_drops),'largestAggregateDrop':min(total_drops,key=lambda x:x['deltaBytes']) if total_drops else None,'perProcess':rows,'boundary':'RSS changes do not prove allocation ownership, GC, memory leak, or a plateau. No alternate samples replace the original four-point verdict.'}
(r/'rss-attribution.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'netBytes':result['sumNet15to30Bytes'],'top':[{'pid':x['pid'],'name':x['name'],'netBytes':x['net15to30Bytes'],'drops':x['observedLast15Minutes']['downwardSteps'],'phaseDeltas':[y['commandBatchDeltaBytes'] for y in x['commandPhases']]} for x in rows if x['net15to30Bytes']],'aggregateDrops':len(total_drops)}))
