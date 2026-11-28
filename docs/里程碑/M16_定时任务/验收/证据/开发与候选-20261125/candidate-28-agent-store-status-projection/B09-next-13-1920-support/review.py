"""Independent paired raster/geometry review from actual private run artifacts."""
import hashlib,json,re,sys
from pathlib import Path
from PIL import Image,ImageChops,ImageStat,ImageDraw
root=Path(sys.argv[1]).resolve(strict=True)
assert re.fullmatch(r'/private/tmp/willyou-m16-b09-c28-1920-pair13-[A-Za-z0-9]+',str(root))
report=json.loads((root/'B09-matrix-1920-additional13-result.json').read_text())
assert report['root']==str(root) and report['schema']=='M16-B09.2-old-C28-1920-additional13-paired-A'
records={r['label']:r for r in report['captures']}
rows={}
for r in report['originalRows']:
 key=(r['side'],r['key']);assert key not in rows;rows[key]=r

def image(meta):
 p=Path(meta['file']);assert p.resolve(strict=True)==p and p.parent==root and p.is_file() and not p.is_symlink()
 assert hashlib.sha256(p.read_bytes()).hexdigest()==meta['sha'];im=Image.open(p).convert('RGB');return im

def rect(v):return (round(v['x']),round(v['y']),round(v['x']+v['width']),round(v['y']+v['height']))

def crop(r):
 shell=image(r['shell']);assert shell.size==(1920,1080)
 composite=False;note='Actual shell only'
 native=r.get('native');ownership=r.get('ownership')
 if isinstance(native,dict) and native.get('file') and ownership:
  page=image(native);places=[x for x in ownership['ownedNativePage'] if x['windowVisible'] and x['visible'] is not False]
  if len(places)==1:
   b=places[0]['bounds'];box=rect(b)
   if page.size==(box[2]-box[0],box[3]-box[1]):
    shell.paste(page,(box[0],box[1]));composite=True;note='Derived shell+actual native placement'
 return shell.crop(rect(r['geometry']['panel'])),composite,note

pairs=[];boards={}
for key in sorted({k for _,k in rows}):
 if ('old-clean',key) not in rows or ('new',key) not in rows:continue
 old=records[rows['old-clean',key]['label']];new=records[rows['new',key]['label']]
 assert old['shell']['size']==new['shell']['size']==[1920,1080]
 originalState=key.split('|')[1];combo=key.split('|')[0]
 a,b=old['geometry'],new['geometry']
 geometry={part:{field:round(b[part][field]-a[part][field],3) for field in ['x','y','width','height']} for part in ['panel','viewport','address'] if a.get(part) and b.get(part)}
 oldPanel,oldDerived,oldNote=crop(old);newPanel,newDerived,newNote=crop(new)
 panelDiff=None
 if oldPanel.size==newPanel.size:panelDiff=ImageStat.Stat(ImageChops.difference(oldPanel,newPanel)).mean
 nativeDiff=None
 if isinstance(old.get('native'),dict) and old['native'].get('file') and isinstance(new.get('native'),dict) and new['native'].get('file'):
  o,n=image(old['native']),image(new['native']);nativeDiff={'oldSize':list(o.size),'newSize':list(n.size),'sameRaster':o.size==n.size and ImageChops.difference(o,n).getbbox() is None,'meanRGBDifference':ImageStat.Stat(ImageChops.difference(o,n)).mean if o.size==n.size else None,'sameUrlAndTitle':old['native']['url']==new['native']['url'] and old['native']['title']==new['native']['title']}
 row={'key':key,'old':old['label'],'new':new['label'],'geometryDelta':geometry,'nativeRaster':nativeDiff,'panelMeanRGBDifference':panelDiff,'derivedAssembledPreview':[oldDerived,newDerived],'oldToolbar':old.get('toolbar'),'newToolbar':new.get('toolbar'),'visualReview':'pending independent human review'};pairs.append(row)
 if True:boards.setdefault(combo,[]).append((originalState,oldPanel,newPanel,oldNote,newNote))
for combo,items in boards.items():
 w=400;panels=[]
 for state,o,n,on,nn in items:
  imgs=[]
  for i in (o,n):
   h=round(i.height*w/i.width);imgs.append(i.resize((w,h),Image.Resampling.LANCZOS))
  panels.append((state,*imgs,on,nn))
 height=32+sum(max(o.height,n.height)+40 for _,o,n,_,_ in panels)
 board=Image.new('RGB',(w*2+24,height),'#eeeeee');draw=ImageDraw.Draw(board);draw.text((8,8),'Old | C28 - '+combo,fill='#222222');y=32
 for state,o,n,on,nn in panels:
  draw.text((8,y),state,fill='#222222');y+=16;board.paste(o,(8,y));board.paste(n,(w+16,y));y+=max(o.height,n.height);draw.text((8,y),on,fill='#222222');draw.text((w+16,y),nn,fill='#222222');y+=24
 board.save(root/('review-'+combo+'.png'))
index={'schema':'B09-1920-actual-paired-review-preparation','root':str(root),'actualOriginalRows':len(rows),'pairedOriginalKeys':len(pairs),'pairs':pairs,'reviewBoards':sorted(str(p) for p in root.glob('review-*-win1920x1080.png')),'boundary':'All originals read and hashed. Composite panels where available are derived from true shell and true native-page PNG plus observed bounds. No OS-compositor or automated visual pass claim.'}
(root/'B09-1920-additional13-pair-review.json').write_text(json.dumps(index,indent=2,ensure_ascii=False)+'\n')
print(json.dumps({'pairedOriginalKeys':len(pairs),'reviewBoards':len(index['reviewBoards']),'index':str(root/'B09-1920-additional13-pair-review.json')}))
