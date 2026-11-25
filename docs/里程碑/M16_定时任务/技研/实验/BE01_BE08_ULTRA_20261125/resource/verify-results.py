#!/usr/bin/env python3
"""Independent offline checks for the fixed fixture; no additional browser or App run."""
from pathlib import Path
from collections import Counter
import hashlib,json,math,sys
from PIL import Image
roots=[Path('/private/tmp/willyou-f36-ultra-resource-w0qrBfb1'),Path('/private/tmp/willyou-f36-ultra-resource-6pxnnjka'),Path('/private/tmp/willyou-f36-ultra-resource-yn5rnje3')]
if len(sys.argv)>1: roots=list(map(Path,sys.argv[1:]))
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
palette=[[255,0,0],[0,255,0],[0,0,255],[255,0,255]]
def dist(x,y):return sum((a-b)**2 for a,b in zip(x,y))**.5
def rgb_eval(rgb,want):
 choices=sorted((dist(rgb,c),i) for i,c in enumerate(palette));return choices[0][1]==want and choices[0][0]<=145 and choices[1][0]-choices[0][0]>=60
out=[]
for root in roots:
 result=json.loads((root/'result.json').read_text());launch=json.loads((root/'launch.json').read_text());manifest=json.loads((root/'manifest.json').read_text());events=[json.loads(l) for l in (root/'raw.jsonl').read_text().splitlines()]
 verify={key:sha(root/key)==val for key,val in manifest['inputHashes'].items()}
 images=[]
 for s in result['screenshots']:
  path=root/s['path'];im=Image.open(path).convert('RGB');want=int(s['expectedStep'])%4
  points=[im.getpixel((int(x*im.width/s['viewport']['width']),int(y*im.height/s['viewport']['height']))) for x in (200,215,230,245,270) for y in (120,130,145,160,175)]
  images.append(dict(name=s['name'],step=s['expectedStep'],actualRGB=points,allExpectedColor=all(rgb_eval(rgb,want) for rgb in points),hashCorrect=sha(path)==s['sha256'],expectedSize=(im.width,im.height)==(s['width'],s['height'])))
 docs={}
 for x in result['documentObservations']:
  v=x['value']
  if 'before' not in v or 'after' not in v:continue
  a,b=v['before'],v['after'];docs[x['name']]={'durationMs':round(b['now']-a['now'],3),'rAFDelta':b['frames']-a['frames'],'timerDelta':b['ticks']-a['ticks'],'cssAnimationDeltaMs':round(float(b['animationTime'])-float(a['animationTime']),3),'visibilityBeforeAfter':[a['visibility'],b['visibility']],'rendererFocusBeforeAfter':[a['focus'],b['focus']],'drawnStepBeforeAfter':[a['drawnStep'],b['drawnStep']],'sameDocument':a['documentId']==b['documentId'],'observedPageEvents':b['entries']}
 closed=result['closed'];by_batch=[]
 for m in result['batchMetrics']:
  c=Counter()
  for p in m['processes']: c[p['type']]+=p['memory']['workingSetSize']
  by_batch.append({'label':m['name'],'openRegistryCount':len(m['topology']['registry']),'webContentsCount':len(m['topology']['wcs']),'hostCount':len(m['topology']['baseWindows']),'missingAssociatedPids':m['missing'],'electronWorkingSetKiB':m['workingSetKiB'],'byProcessTypeKiB':dict(c),'electronProcessIDs':[(p['pid'],p['type']) for p in m['processes']],'residualVersionCount':m.get('residueMetadataFileCount')})
 results=dict(root=str(root),status=result['status'],error=result.get('error'),inputsVerified=verify,processExit=launch,assertions={'pass':sum(c['ok'] for c in result['checks']),'fail':[c['name'] for c in result['checks'] if not c['ok']]},images=images,observations=docs,closedCount=len(closed),allRecordedCloseLiveResourcesGone=all(c['actualDestroyed'] and c['helper']['daemonState']=='stopped' and c['helper']['clientStopped'] and c['helper']['socketFilesRemoved'] and c['closedQueue'] and c['pendingQueue']==0 and all(e.endswith('.version') for e in c['socketFilesAfter']['entries']) for c in closed),residualMetadataCount=sum(sum(e.endswith('.version') for e in c['socketFilesAfter']['entries']) for c in closed),batchMetrics=by_batch,final=result.get('final'))
 out.append(results)
print(json.dumps(out,indent=2))
assert all(all(x['inputsVerified'].values()) and all(s['allExpectedColor'] and s['hashCorrect'] and s['expectedSize'] for s in x['images']) and not x['processExit']['processGroupMembersAfterExit'] for x in out)
