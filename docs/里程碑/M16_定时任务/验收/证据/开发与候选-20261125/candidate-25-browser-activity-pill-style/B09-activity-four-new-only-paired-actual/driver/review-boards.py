from pathlib import Path
import json,hashlib,math
from PIL import Image,ImageDraw,ImageFont,ImageChops
repo=Path('/Users/liubu/hx/4.uprxiao/SmartDD');run=Path('/private/tmp/willyou-m16-b09-c25-activity-four-new-only-vvCzMv');out=run/'derived-review';out.mkdir(exist_ok=True)
oldRoot=repo/'docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125/candidate-24-browser-control-style-cascade/B09-activity-four-paired-actual-red';r=json.loads((run/'B09-C25-activity-four-new-only-result.json').read_text());prior=json.loads((oldRoot/'actual-result.json').read_text());idx=json.loads((oldRoot/'index.json').read_text());prev=json.loads((oldRoot/'review/comparison-facts.json').read_text())
sha=lambda x:hashlib.sha256(Path(x).read_bytes()).hexdigest();load=lambda p:json.loads(Path(p).read_text());assert sha(oldRoot/'index.json')=='0a7a7fa62685f9205cb4fc1d2abdeef32cfe327db3df91ce18716054fe88f1a3';assert sha(oldRoot/'actual-result.json')=='64d702b729e0dc90e60b36ee610b8a0ca941d962d8055178ed4c481123bf27a4';assert sha(run/'B09-C25-activity-four-new-only-result.json')=='f1396315abbaf6f9bba2fb83c3ee63ad931bb0415890d5b2ca28fb4768c73d8d'
def ref(p):return {'path':str(p.relative_to(repo))if p.is_relative_to(repo)else str(p),'sha256':sha(p),'bytes':p.stat().st_size}
def img(p,s=None):
 x=Image.open(p).convert('RGB');return x if s is None else x.resize(s,Image.Resampling.LANCZOS)
def board(items,cols,name,force=None):
 if force:items=[(s,x.resize(force,Image.Resampling.LANCZOS))for s,x in items]
 w=max(i.width for _,i in items);h=max(i.height for _,i in items);gap=10;title=23
 b=Image.new('RGB',(gap+cols*(w+gap),gap+math.ceil(len(items)/cols)*(h+title+gap)),(248,248,248));d=ImageDraw.Draw(b);f=ImageFont.load_default()
 for i,(s,x)in enumerate(items):
  ox=gap+i%cols*(w+gap);oy=gap+i//cols*(h+title+gap);d.text((ox,oy+4),s,fill='black',font=f);b.paste(x,(ox,oy+title))
 p=out/name;b.save(p);return p
refs=[];states=['B09-agent-active','B10-paused','B10-resumed','B09-agent-hold'];buttons={}
for combo in sorted({x.split('|')[0]for x in r['matrixKeys']}):
 full=[];strips=[];width=int(combo.split('-rw')[1].split('-')[0])
 for st in states:
  key=combo+'|'+st;c=next(x for x in r['captures']if x['key']==key);p=next(x for x in prev if x['key']==key);ip=next(x for x in idx['pairs']if x['key']==key);o=next(x for x in prior['captures']if x['key']==key and x['side']=='old-clean');c24=next(x for x in prior['captures']if x['key']==key and x['side']=='new');pc=next(x for x in r['pairs']if x['originalKey']==key)
  ons=oldRoot/ip['actualOld']['file'];cps=oldRoot/ip['actualC24']['file'];ns=Path(c['shell']['file']);assert sha(ons)==o['shell']['sha']==pc['old'];assert sha(cps)==c24['shell']['sha'];assert sha(ns)==c['shell']['sha']==pc['new'];assert pc['oldNativeRoots']==2 and pc['newNativeRoots']==1
  for q in [ons,cps,ns]: im=Image.open(q);assert im.size==(2880,1800)and im.format=='PNG';im.verify()
  af,am,pf,pm=[repo/p[k]['path']for k in ['latestOriginalA','latestOriginalAMetadata','approvedP','approvedPMetadata']];assert all(sha(q)==p[k]['sha256']for q,k in zip((af,am,pf,pm),['latestOriginalA','latestOriginalAMetadata','approvedP','approvedPMetadata']))
  a=load(am)['agent'];ap=a['paused'] if st=='B10-paused' else a['agent'];np=c['agent']['paused']if st=='B10-paused'else c['agent']['agent'];cp=c24['agent']['paused']if st=='B10-paused'else c24['agent']['agent'];ai=img(af);pi=img(pf);oi=img(ons,(1440,900));ci=img(cps,(1440,900));ni=img(ns,(1440,900));assert ai.size==pi.size==(1440,900)
  full.extend([(st+' C24 actual red',ci),(st+' C25 actual',ni)])
  x=round(np['rect']['x'])-2;bottom=max(ap['rect']['bottom'],np['rect']['bottom'])+18
  for label,im in [('Latest original A',ai),('Original approved P',pi),('C24 actual RED',ci),('C25 actual',ni)]:
   strip=im.crop((x,0,1438,round(bottom)))
   if width==900:strip=strip.resize((670,round(strip.height*670/strip.width)),Image.Resampling.LANCZOS)
   strips.append((st+' '+label,strip))
  btnset=buttons.setdefault(combo.split('-rw')[0],[])
  for label,im,top in [('A original',ai,32),('C24 actual RED',ci,41),('C25 actual',ni,41)]:
   crop=im.crop((1240,top,1407,top+44)).resize((334,88),Image.Resampling.NEAREST)
   btnset.append((combo.split('-win')[0]+' '+st+' '+label,crop))
  panel=c['native']['g']['panel'];px=int(panel['x']*2);right=int((panel['x']+panel['width'])*2);diff=ImageChops.difference(img(cps),img(ns)); ow=ImageChops.difference(img(ons),img(ns));band=(px,0,right,350)
  # Coordinate regions are deterministic but not acceptance substitutes. Full images are viewed.
  reg=lambda d:{'globalBBoxRaw':d.getbbox(),'leftOfPanel':d.crop((0,0,px,1800)).getbbox(),'rightOfPanel':d.crop((right,0,2880,1800)).getbbox(),'browserLowerAfter350':d.crop((px,350,right,1800)).getbbox(),'browserHeaderBand':d.crop(band).getbbox()}
  diffs={}
  for n in ['agent','paused','resumeStyle','dot','glow']:
   aa,nn=a.get(n),c['agent'].get(n)
   if aa and nn:
    if n in ['agent','paused']:aa,nn=aa['style'],nn['style']
    diffs[n]={z:[aa.get(z),nn.get(z)] for z in nn if z not in ['rect'] and aa.get(z)!=nn.get(z)}
  facts=c['pillStyle'];assert facts['passed'] and facts['normal']['rect']['width']==101.421875 and facts['normal']['rect']['height']==32
  refs.append({'key':key,'latestOriginalA':p['latestOriginalA'],'latestOriginalAMetadata':p['latestOriginalAMetadata'],'approvedP':p['approvedP'],'approvedPMetadata':p['approvedPMetadata'],'retainedOldActual':ref(ons),'retainedC24ActualRed':ref(cps),'C25Actual':ref(ns),'C25VersusLatestOriginalRecordedStyleDiff':diffs,'normalStyle':facts['normal']['style'],'hoverStyle':facts['hover']['style'],'restoredHover':facts['restored']['hovered'],'icon':facts['normal']['icons'][0],'originalBar':ap['rect'],'C24Bar':cp['rect'],'C25Bar':np['rect'],'currentPillRect':facts['restored']['rect'],'originalStrictActualPredicate':c['originalVisualPredicate'],'C24NewPixelRegion':reg(diff),'oldNewPixelRegion':reg(ow),'headerBoard':'review/'+combo+'-header-comparison.png','fullBoard':'review/'+combo+'-full-c24-c25-actual.png'})
 board(strips,4,combo+'-header-comparison.png');board(full,2,combo+'-full-c24-c25-actual.png',(720,450))
for t,x in buttons.items():board(x,3,t+'-toolbar-button-detail.png')
(out/'comparison-facts.json').write_text(json.dumps(refs,ensure_ascii=False,indent=2)+'\n'); print('points',len(refs),'boards',len(list(out.glob('*.png'))),'facts sha',sha(out/'comparison-facts.json')); print('diffs',[(j['key'],j['C25VersusLatestOriginalRecordedStyleDiff'],j['currentPillRect'],j['C24NewPixelRegion']['browserLowerAfter350'],j['C24NewPixelRegion']['rightOfPanel']) for j in refs])
