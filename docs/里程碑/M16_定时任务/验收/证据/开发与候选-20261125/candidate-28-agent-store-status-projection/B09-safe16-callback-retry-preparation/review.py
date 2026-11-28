"""Read/hash actual shell and optional native originals; no automatic visual pass."""
import hashlib,json,re,sys
from PIL import Image,ImageChops,ImageStat,ImageDraw
from pathlib import Path
r=Path(sys.argv[1]).resolve(strict=True);assert re.fullmatch(r'/private/tmp/willyou-m16-b09-c28-1920-safe16-pair-[A-Za-z0-9]+',str(r));j=json.loads((r/'B09-safe16-pair-result.json').read_text());assert j['root']==str(r) and j['schema']=='M16-B09.2-1920-safe16-actual-pair-A'
rows={}
for c in j['captures']:
 if c['passed']:
  k=(c['side'],c['theme']+'-rw'+str(c['width'])+'-win1920x1080|'+c['state']);assert k not in rows;rows[k]=c

def im(meta):
 p=Path(meta['file']);assert p.parent==r and p.resolve(strict=True)==p and not p.is_symlink();assert hashlib.sha256(p.read_bytes()).hexdigest()==meta['sha'];a=Image.open(p).convert('RGB');assert list(a.size)==meta['size'];return a
def rect(b):return (round(b['x']),round(b['y']),round(b['x']+b['width']),round(b['y']+b['height']))
def derived(c):
 a=im(c['shell']);native=c.get('native');combined=False
 if native:
  n=im(native);places=[p for p in c['ownership']['placements'] if p['main'] and p['visible'] and p['index']>c['ownership']['shell']['index']];assert len(places)==1;b=rect(places[0]['bounds']);assert n.size==(b[2]-b[0],b[3]-b[1]);a.paste(n,(b[0],b[1]));combined=True
 return a.crop(rect(c['geometry']['panel'])),combined
pairs=[];boards={}
for key in sorted({k for _,k in rows}):
 if ('old-clean',key) not in rows or ('new',key) not in rows:continue
 o,n=(rows[(s,key)] for s in ['old-clean','new']);a,ac=derived(o);b,bc=derived(n);g={p:{k:round(n['geometry'][p][k]-o['geometry'][p][k],3) for k in ['x','y','width','height']} for p in ['panel','viewport','address'] if o['geometry'].get(p) and n['geometry'].get(p)};pairs.append({'key':key,'old':o['label'],'new':n['label'],'geometryDelta':g,'targetUiRectDelta':{k:round(n['ui']['rect'][k]-o['ui']['rect'][k],3) for k in ['x','y','width','height']},'panelMeanRGBDiff':ImageStat.Stat(ImageChops.difference(a,b)).mean if a.size==b.size else None,'derivedNativeComposite':[ac,bc],'visualJudgment':'pending actual target review'});boards.setdefault(key.split('|')[0],[]).append((key.split('|')[1],a,b))
for k,rs in boards.items():
 w=400;items=[]
 for state,a,b in rs:
  resize=lambda x:x.resize((w,round(x.height*w/x.width)),Image.Resampling.LANCZOS);items.append((state,resize(a),resize(b)))
 h=36+sum(max(a.height,b.height)+32 for _,a,b in items);board=Image.new('RGB',(w*2+24,h),'#eee');drawer=ImageDraw.Draw(board);drawer.text((8,8),'Old | C28 - '+k,fill='#222');y=34
 for title,a,b in items:
  drawer.text((8,y),title,fill='#222');y+=16;board.paste(a,(8,y));board.paste(b,(w+16,y));y+=max(a.height,b.height)+16
 board.save(r/('review-'+k+'.png'))
idx={'schema':'B09-safe16-pair-review','root':str(r),'actualRows':len(rows),'pairedKeys':len(pairs),'pairs':pairs,'boundary':'Actual hashed shell/raw separate native images. Where combined, explicitly derived by actual bounds; no system compositor or automatic visual pass.'};(r/'B09-safe16-pair-review.json').write_text(json.dumps(idx,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'root':str(r),'actualRows':len(rows),'pairedKeys':len(pairs)}))
