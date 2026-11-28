"""Derived pair review; actual old/new permission captures are already separate."""
import hashlib, json, re, sys
from pathlib import Path
from PIL import Image,ImageChops,ImageStat,ImageDraw

root=Path(sys.argv[1]).resolve(strict=True)
assert re.fullmatch(r'/private/tmp/willyou-m16-b09-c28-mapped-approval-pair-[A-Za-z0-9]+',str(root))
report=json.loads((root/'B09-mapped-approval-pair-result.json').read_text())
assert report['root']==str(root) and report['schema']=='M16-B09.2-M14-mapped-pending-browser-access-pair-A'
rows={}
for x in report['captures']:
 if not x['passed']:continue
 k=(x['side'],x['key']);assert k not in rows;rows[k]=x
 assert x['requestId']==x['denial']['requestId'] and x['denial']['systemNotice']=={'code':'businessRequestRetired','detail':'用户拒绝'}
 assert x['denial']['noGrant']['grants']==[] and x['denial']['record']['row']['status']=='retired'
def im(meta):
 p=Path(meta['file']);assert p.resolve(strict=True)==p and p.parent==root and p.is_file() and not p.is_symlink()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==meta['sha']
 x=Image.open(p).convert('RGB');assert list(x.size)==meta['size'];return x
def box(r):return tuple(round(r[k]) for k in ['x','y','right','bottom'])
def delta(a,b):
 return {'oldSize':a.size,'newSize':b.size,'equal':a.size==b.size and ImageChops.difference(a,b).getbbox() is None,
  'meanRGB':ImageStat.Stat(ImageChops.difference(a,b)).mean if a.size==b.size else None}
pairs=[];boards={}
for key in sorted({k for _,k in rows}):
 if ('old-clean',key) not in rows or ('new',key) not in rows:continue
 old,new=(rows[(s,key)] for s in ('old-clean','new'))
 assert old['target']['url']==new['target']['url'] and old['mode']==new['mode']
 crops=[];native=[]
 for x in (old,new):
  shell=im(x['shell']);page=im(x['native']);bounds=x['native']['bounds'];assert page.size==(bounds['width'],bounds['height'])
  crop=shell.crop(box(x['approval']['card']));crops.append(crop);native.append(page)
 fields=['x','y','width','height'];parts=['card','head','review','list','reason','footer','confirm','stop','composer','composerInput']
 g={part:{f:round(new['approval'][part][f]-old['approval'][part][f],3) for f in fields} for part in parts}
 row={'key':key,'old':old['label'],'new':new['label'],'geometryDelta':g,'approvalRaster':delta(*crops),'nativeRaster':delta(*native),
  'sameOptionsAndDescriptions':[(o['label'],o['description'],o['number']) for o in old['approval']['options']]==[(o['label'],o['description'],o['number']) for o in new['approval']['options']],
  'actualOldNewDenials':[old['denial']['requestId'],new['denial']['requestId']],'visualJudgement':'pending target review'}
 pairs.append(row);boards.setdefault(key.split('|')[0],[]).append((key.split('|')[1],*crops))
for combo,items in boards.items():
 w=700;images=[]
 for title,o,n in items:
  scale=lambda a:a.resize((w,round(a.height*w/a.width)),Image.Resampling.LANCZOS)
  images.append((title,scale(o),scale(n)))
 height=34+sum(max(o.height,n.height)+38 for _,o,n in images)
 b=Image.new('RGB',(w*2+24,height),'#eef0ef');d=ImageDraw.Draw(b);d.text((8,8),'Old | C28 actual mapped request card: '+combo,fill='#222222');y=34
 for title,o,n in images:
  d.text((8,y),title,fill='#222222');y+=18;b.paste(o,(8,y));b.paste(n,(w+16,y));y+=max(o.height,n.height)+20
 b.save(root/('review-'+combo+'.png'))
index={'schema':'B09-mapped-approval-actual-pair-review-preparation','root':str(root),'actualOriginalRows':len(rows),'pairedOriginalKeys':len(pairs),'pairs':pairs,'boundary':'Actual raw shell request-card crop and separate own native page image; derived review board only. Task identification fixture IDs differ. No automated visual verdict or physical S claim.'}
(root/'B09-mapped-approval-pair-review.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'root':str(root),'actualRows':len(rows),'pairedKeys':len(pairs)}))
