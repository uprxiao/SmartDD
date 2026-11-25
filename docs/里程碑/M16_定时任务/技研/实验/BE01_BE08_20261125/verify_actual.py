#!/usr/bin/env python3
"""Offline verification of fixed local fixture result/capture evidence; no App or network."""
from pathlib import Path
from PIL import Image, ImageChops
import hashlib, json
root=Path(__file__).resolve().parent

def load(folder):return json.loads((root/folder/'result.json').read_text())
def all_checks(d,expected,status):
    assert d['status']==status and len(d['checks'])==expected and all(c['ok'] for c in d['checks'])
    assert d['exit']['code']==0 and d['exit']['signal'] is None and not d['rendererErrors'] and d['fixtureServerClosed']
def pixels(path,receipt,points,green):
    im=Image.open(path).convert('RGB');w,h=receipt['after']['width'],receipt['after']['height'];sx,sy=im.width/w,im.height/h
    assert sx>0 and sy>0 and abs(sx-sy)<.02
    values=[im.getpixel((round(x*sx),round(y*sy))) for x,y in points]
    for r,g,b in values:
        assert (g>210 and g-r>85 and g-b>85) if green else (r>210 and r-g>85 and r-b>85), (path,values)
    return {'file':str(path.relative_to(root)),'size':[im.width,im.height],'pixelRGB':values,'CSSScale':[sx,sy]}
base=load('ui/fresh/baseline');cand=load('ui/fresh/candidate');all_checks(base,15,'passed-fixture-flow');all_checks(cand,15,'passed-fixture-flow')
assert [c['name'] for c in base['checks']]==[c['name'] for c in cand['checks']]
keys=['aOpen','bOpen','aBackground','restored','overlay','closed','reopened']
assert all(len(base['observations'][k]['native']['base'])==2 for k in keys)
assert all(len(cand['observations'][k]['native']['base'])==1 and not cand['observations'][k]['native']['browserWindowIds'] for k in keys)
assert all(len(d['observations']['startup']['base'])==1 for d in (base,cand))
co=cand['observations'];a=co['aForeground']['id'];s=co['aBackground']['native']['shellId'];b=next(w['id'] for w in co['aBackground']['native']['webContents'] if w['url'].endswith('/b'))
order=lambda k:[v['id'] for v in co[k]['native']['base'][0]['children']]
assert order('aBackground')==[a,s,b] and order('restored')==[b,s,a] and order('overlay')[-1]==s and a not in order('closed')
pixel_records=[]
for folder,d in [('ui/fresh/baseline',base),('ui/fresh/candidate',cand)]:
    for key,receipt,green in [('visible',d['observations']['aForeground'],False),('background',d['observations']['aBackground']['page'],True)]:
        pixel_records.append(pixels(root/folder/receipt['captureFile'],receipt,[(200,155),(225,180),(250,200)],green))
shots=[]
for name in ['main-home.png','a-shell.png','b-shell.png','menu-shell.png','reopened-shell.png']:
    old=Image.open(root/'ui/fresh/baseline'/name).convert('RGB');new=Image.open(root/'ui/fresh/candidate'/name).convert('RGB');assert old.size==new.size==(1320,850)
    same=sum(1 for px in ImageChops.difference(old,new).get_flattened_data() if px==(0,0,0))/(old.width*old.height)
    assert same>.98
    shots.append({'name':name,'size':list(old.size),'equalPixelFraction':same,'boundary':'AppShell capture only, not native composite/system' })
for folder in ['ui/restore/baseline','ui/restore/candidate']:
    d=load(folder);all_checks(d,12,'passed-restore-compat');assert d['oldDataSource']['copiedOwnerMatches'];assert d['oldDataSource']['oldDbHash']==d['oldDataSource']['copyDbHash'];assert d['oldDataSource']['oldWalSize']==0
    for path in ['/reopen','/b']:assert any(x['pathname']==path and x['oldFixtureCookieSent'] for x in d['requests'])
    assert d['observations']['htmlPreview']['page']['text']=='F36 HTML preview\n\nFixture only'
regfolder='native-registry/runs/registry-cold-2cbzxvvx';reg=load(regfolder);launch=json.loads((root/regfolder/'launch.json').read_text());assert reg['status']=='passed' and launch['exitCode']==0 and len(reg['checks'])==27 and all(c['ok'] for c in reg['checks']) and reg['final']=={'windows':0,'contents':0}
assert all(not t['systemWindowVisible'] and not t['systemWindowFocused'] and len(t['windows'])==1 for t in reg['topology'])
assert len(reg['cleanup'])==3 and all(c['contentsDestroyed'] and c['helper']['clientStopped'] and c['helper']['daemonState']=='stopped' and c['helper']['socketFilesRemoved'] for c in reg['cleanup'])
for receipt in reg['receipts']:
    path=root/regfolder/receipt['screen']['file'];assert hashlib.sha256(path.read_bytes()).hexdigest()==receipt['screen']['sha256']
    pixel_records.append(pixels(path,receipt,[(180,100),(210,128),(245,155)],receipt['after']['clicks']%2==0))
foreground=[]
for folder,mode in [('ui/foreground-confirm/baseline','baseline'),('ui/foreground-confirm/candidate','candidate')]:
    d=load(folder);all_checks(d,24,'passed-fixture-flow');o=d['observations'];reopen=o['reopened'];newpage=reopen['page']['id'];windows=reopen['native']['base'];main=next(w for w in windows if w['title']=='WillYou');assert main['children'][-1]['id']==newpage
    hidden=o['hidden'];hidden_main=next(w for w in hidden['native']['base'] if w['title']=='WillYou');assert not hidden_main['visible'] and not hidden_main['focused']
    assert len(hidden['native']['base'])==(1 if mode=='candidate' else 2)
    if mode=='baseline':assert any(w['title']=='WillYou browser background' for w in hidden['native']['base'])
    restored=o['windowRestored'];assert restored['page']['id']==newpage and restored['page']['after']['origin']==hidden['page']['after']['origin'] and restored['page']['after']['clicks']==hidden['page']['after']['clicks']
    shot=hidden['page'];pixel_records.append(pixels(root/folder/shot['captureFile'],shot,[(200,155),(225,180),(250,200)],False))
    foreground.append({'mode':mode,'checks':24,'foregroundReopenedNativeId':newpage,'windowCountWhileMainHidden':len(hidden['native']['base']),'actualHiddenClickAndRestore':True,'exitCode':d['exit']['code']})
result={'freshChecksEach':15,'expandedForegroundAndNativeHideChecks':foreground,'restoreChecksEach':12,'candidateWindowCount':1,'oldWindowCountAfterFirstPage':2,'backgroundOrder':[a,s,b],'foregroundRestoredOrder':[b,s,a],'overlayOrder':order('overlay'),'shellShots':shots,'registryChecks':27,'registryCleanup':reg['final'],'pixelVerifications':pixel_records,'scope':'E/I/development UI only; no formal product A/S'}
print(json.dumps(result,ensure_ascii=False,indent=2))
