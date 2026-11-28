from pathlib import Path
import json,hashlib,math
from PIL import Image,ImageDraw,ImageFont,ImageChops
repo=Path('/Users/liubu/hx/4.uprxiao/SmartDD');run=Path('/private/tmp/willyou-m16-b09-c24-activity-four-pair-XoBYIa');out=run/'derived-review';out.mkdir(exist_ok=True)
orig=repo/'docs/里程碑/M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145';r=json.loads((run/'B09-C24-activity-four-result.json').read_text());active=json.loads((orig/'active-empty16-original-applicability/review-original16.json').read_text());later=json.loads((orig/'activity23-current064-scope-adjudication-001/activity23-review.json').read_text())
sha=lambda x:hashlib.sha256(Path(x).read_bytes()).hexdigest();load=lambda p:json.loads(Path(p).read_text())
def resolve_ref(v,alternates=[]):
 p=Path(v['path']);h=v['sha256']
 for z in [p]+alternates:
  if z.is_file()and sha(z)==h:return z
 raise AssertionError(('missing exact original',p,h))
def ref(p):return {'path':str(p.relative_to(repo))if p.is_relative_to(repo)else str(p),'sha256':sha(p),'bytes':p.stat().st_size}
def img(p,s=None):
 x=Image.open(p).convert('RGB');return x if s is None else x.resize(s,Image.Resampling.LANCZOS)
def board(items,cols,name,force=None):
 if force:items=[(s,x.resize(force,Image.Resampling.LANCZOS))for s,x in items]
 w=max(i.width for _,i in items);h=max(i.height for _,i in items);gap=10;title=22
 b=Image.new('RGB',(gap+cols*(w+gap),gap+math.ceil(len(items)/cols)*(h+title+gap)),(247,247,247));d=ImageDraw.Draw(b);f=ImageFont.load_default()
 for i,(s,x)in enumerate(items):
  ox=gap+i%cols*(w+gap);oy=gap+i//cols*(h+title+gap);d.text((ox,oy+3),s,fill='black',font=f);b.paste(x,(ox,oy+title))
 p=out/name;b.save(p);return p
refs=[];states=['B09-agent-active','B10-paused','B10-resumed','B09-agent-hold'];buttons={}
for combo in sorted({x.split('|')[0]for x in r['matrixKeys']}):
 full=[];strips=[];width=int(combo.split('-rw')[1].split('-')[0])
 for st in states:
  key=combo+'|'+st;cs=[x for x in r['captures']if x['key']==key];assert len(cs)==2
  old,new=next(x for x in cs if x['side']=='old-clean'),next(x for x in cs if x['side']=='new')
  for c in cs:
   p=Path(c['shell']['file']);assert sha(p)==c['shell']['sha'];im=Image.open(p);assert im.size==(2880,1800)and im.format=='PNG';im.verify()
  if st=='B09-agent-active':
   arow=next(x for x in active['rows']if x['key']==key);A,AM,P,PM=arow['A'],arow['AMetadata'],arow['P'],arow['PMetadata'];pbutton=arow['facts']['pauseButton']
  else:
   arow=next(x for x in later['rows']if x['key']==key);A,AM,P,PM=[arow[k]for k in ['sourceCapture','sourceMetadata','prototypeCapture','prototypeMetadata']];pbutton=arow['metadata'].get('resume')
  af=resolve_ref(A);am=resolve_ref(AM);pf=resolve_ref(P,[af.parent/'reference'/Path(P['path']).name,orig/'App044-agent-pause-A025-captured32/reference'/Path(P['path']).name]);pm=resolve_ref(PM,[af.parent/'reference'/Path(PM['path']).name,orig/'App044-agent-pause-A025-captured32/reference'/Path(PM['path']).name]);a=load(am)['agent'];ap=a['paused'] if st=='B10-paused'else a['agent'];op=old['agent']['paused']if st=='B10-paused'else old['agent']['agent'];np=new['agent']['paused']if st=='B10-paused'else new['agent']['agent'];ai=img(af);pi=img(pf);oi=img(Path(old['shell']['file']),(1440,900));ni=img(Path(new['shell']['file']),(1440,900));assert ai.size==pi.size==(1440,900)
  full.extend([(st+' old actual',oi),(st+' C24 actual',ni)])
  # Browser header strips include tab dot, both toolbar pill controls, banner and native frame edge.
  x=round(np['rect']['x'])-2;bottom=max(ap['rect']['bottom'],np['rect']['bottom'])+18
  for label,im in [('Latest original A',ai),('Original approved P',pi),('Frozen old actual',oi),('C24 actual',ni)]:
   strip=im.crop((x,0,1438,round(bottom)))
   if width==900:strip=strip.resize((670,round(strip.height*670/strip.width)),Image.Resampling.LANCZOS)
   strips.append((st+' '+label,strip))
  btnset=buttons.setdefault(combo.split('-rw')[0],[])
  # Dedicated 2x crop of original/candidate right-toolbar buttons, readable even at full wide browser width.
  for label,im,top in [('A original',ai,32),('C24 actual',ni,41)]:
   crop=im.crop((1240,top,1407,top+44)).resize((334,88),Image.Resampling.NEAREST)
   btnset.append((combo.split('-win')[0]+' '+st+' '+label,crop))
  rgb=ImageChops.difference(img(Path(old['shell']['file'])),img(Path(new['shell']['file'])));panel=new['native']['g']['panel'];px=int(panel['x']*2);right=int((panel['x']+panel['width'])*2)
  diffR={'globalBBoxRaw':rgb.getbbox(),'leftOfPanel':rgb.crop((0,0,px,1800)).getbbox(),'rightOfPanel':rgb.crop((right,0,2880,1800)).getbbox(),'exactSHA':old['shell']['sha']==new['shell']['sha']}
  ad=a;nd=new['agent'];diffs={}
  for n in ['agent','paused','resumeStyle','dot','glow']:
   aa,nn=ad.get(n),nd.get(n)
   if aa and nn:
    if n in ['agent','paused']:
     aa,nn=aa['style'],nn['style']
    dif={z:[aa.get(z),nn.get(z)]for z in nn if z not in ['rect']and aa.get(z)!=nn.get(z)};diffs[n]=dif
  refs.append({'key':key,'latestOriginalA':ref(af),'latestOriginalAMetadata':ref(am),'approvedP':ref(pf),'approvedPMetadata':ref(pm),'referencePauseOrResumeTarget':pbutton,'C24VersusLatestActualRecordedStyleDiff':diffs,'bothActualStyleVerdicts':[old['originalVisualPredicate'],new['originalVisualPredicate']],'originalBar':ap['rect'],'C24Bar':np['rect'],'oldBar':op['rect'],'oldNewPixelRegion':diffR,'reviewBoard':'review/'+combo+'-header-comparison.png','fullBoard':'review/'+combo+'-full-actual.png'})
 board(strips,4,combo+'-header-comparison.png');board(full,2,combo+'-full-actual.png',(720,450))
for t,x in buttons.items():board(x,4,t+'-toolbar-button-detail.png')
(out/'comparison-facts.json').write_text(json.dumps(refs,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'points':len(refs),'boards':len(list(out.glob('*.png'))),'latestA':{x['key']:Path(x['latestOriginalA']['path']).parent.name for x in refs}},ensure_ascii=False))
