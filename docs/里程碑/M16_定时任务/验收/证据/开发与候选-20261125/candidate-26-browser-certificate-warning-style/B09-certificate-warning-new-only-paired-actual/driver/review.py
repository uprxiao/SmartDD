from pathlib import Path
import json,hashlib,math
from PIL import Image,ImageDraw,ImageFont
repo=Path('/Users/liubu/hx/4.uprxiao/SmartDD');root=Path('/private/tmp/willyou-m16-b09-c26-certificate-warning-new-only-M61CwY');out=root/'derived-review';out.mkdir(exist_ok=True);base=repo/'docs/里程碑/M16_定时任务/验收/证据/开发与候选-20261125/candidate-25-browser-activity-pill-style';oldRoot=base/'B09-certificate-warning-old-actual-fixture-close-red';redRoot=base/'B09-certificate-warning-new-only-actual-visual-red';sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();rp=root/'B09-C26-certificate-warning-result.json';r=json.loads(rp.read_text());pOld=json.loads((oldRoot/'actual-result.json').read_text());iOld=json.loads((oldRoot/'index.json').read_text());pRed=json.loads((redRoot/'actual-result.json').read_text());iRed=json.loads((redRoot/'index.json').read_text());assert sha(rp)=='a52b181354a064d12a92e5f421187a37834bd82789a4cd35363117c1d075b156';assert sha(oldRoot/'index.json')=='813d0ddee2594d52d35a4f8038cb37264d6fb235405efc9328c6585bb45dae84';assert sha(redRoot/'index.json')=='3aef9a8cff58baca0162c03a1d8d50678ef8538d8f0be9dc25d31bd3885de06f'
def load(p,s=None):i=Image.open(p).convert('RGB');return i if s is None else i.resize(s,Image.Resampling.LANCZOS)
def ref(p):return {'path':str(p.relative_to(repo))if p.is_relative_to(repo)else str(p),'sha256':sha(p),'bytes':p.stat().st_size}
def board(items,cols,name):
 gap=12;top=22;w=max(i.width for _,i in items);h=max(i.height for _,i in items);b=Image.new('RGB',(gap+cols*(w+gap),gap+math.ceil(len(items)/cols)*(h+top+gap)),(248,248,248));d=ImageDraw.Draw(b);font=ImageFont.load_default()
 for i,(label,img)in enumerate(items):x=gap+i%cols*(w+gap);y=gap+i//cols*(h+top+gap);d.text((x,y+3),label,fill='black',font=font);b.paste(img,(x,y+top))
 b.save(out/name)
rows=[];details={}
for c in r['captures']:
 key=c['key'];comb=key.split('|')[0];o=next(x for x in pOld['captures']if x['key']==key);red=next(x for x in pRed['captures']if x['key']==key);oi=next(x for x in iOld['keys']if x['key']==key);ri=next(x for x in iRed['keys']if x['key']==key);op=oldRoot/oi['actualOld']['file'];cp=redRoot/ri['actualC25']['file'];np=Path(c['image']['file']);assert sha(op)==o['image']['sha'] and sha(cp)==red['image']['sha'] and sha(np)==c['image']['sha'];
 for f in [np,op,cp]:im=Image.open(f);assert im.size==(2880,1800);im.verify()
 targets=r['originalTargets'][key];ap,am,pp,pm=[Path(targets[k]['path'])for k in ['actualA','actualAMetadata','approvedP','approvedPMetadata']];assert all(sha(x)==targets[k]['sha']for x,k in zip((ap,am,pp,pm),['actualA','actualAMetadata','approvedP','approvedPMetadata']));a=json.loads(am.read_text());ai,pi,oldi,redi,ni=load(ap),load(pp),load(op,(1440,900)),load(cp,(1440,900)),load(np,(1440,900));assert ai.size==pi.size==(1440,900);width=c['metadata']['pane']['width'];x=int(c['metadata']['pane']['x']);assert width in [480,900]
 panels=[];full=[('Latest original A',ai),('Approved P',pi),('C25 actual RED',redi),('C26 actual',ni)]
 for n,z in full:
  pane=z.crop((x,0,1438,900));scale=480 if width==480 else 670;panels.append((n,pane.resize((scale,round(pane.height*scale/pane.width)),Image.Resampling.LANCZOS)))
 board(panels,4,comb+'-warning-panel-comparison.png');board([(n,z.resize((720,450),Image.Resampling.LANCZOS))for n,z in [('Original A',ai),('Approved P',pi),('Frozen old actual',oldi),('C26 actual',ni)]],2,comb+'-full-old-c26-comparison.png')
 def act(m):return next(z for z in m['components']if z['selector']=='.bw-cert .bw-failure-actions')['rect']
 for label,z,b in [('ORIGINAL A',ai,act(a['metadata'])),('C25 actual RED',redi,act(red['metadata'])),('C26 actual',ni,act(c['metadata']))]:
  mid=(b['x']+b['right'])/2;cx=round(mid);cy=round((b['y']+b['bottom'])/2);detail=z.crop((cx-122,cy-27,cx+122,cy+27)).resize((488,108),Image.Resampling.NEAREST);details.setdefault(c['metadata']['theme'],[]).append((comb+' '+label,detail))
 ds={}
 for sel in ['.bw-cert>svg','.bw-cert h2','.bw-cert p','.bw-cert .bw-error-name','.bw-cert .fw-pill','.bw-cert .bw-danger-link','.bw-security']:
  aa=[x for x in a['metadata']['components']if x['selector']==sel];nn=[x for x in c['metadata']['components']if x['selector']==sel];oo=[x for x in o['metadata']['components']if x['selector']==sel];cr=[x for x in red['metadata']['components']if x['selector']==sel];assert len(aa)==len(nn)==len(oo)==len(cr);ds[sel]=[{'originalStyle':v['style'],'frozenOldStyle':w['style'],'C25RedStyle':u['style'],'C26Style':z['style'],'originalRect':v['rect'],'C26Rect':z['rect'],'currentStyleDifferences':{k:[v['style'].get(k),z['style'].get(k)]for k in v['style']if v['style'].get(k)!=z['style'].get(k)}}for v,w,u,z in zip(aa,oo,cr,nn)]
 rows.append({'key':key,'originalReferences':targets,'oldActual':ref(op),'C25ActualRed':ref(cp),'C26Actual':ref(np),'compare':ds,'actualComputedNormalHoverProof':c['controlStyles'],'panelBoard':'review/'+comb+'-warning-panel-comparison.png','fullBoard':'review/'+comb+'-full-old-c26-comparison.png'})
for theme,items in details.items():board(items,3,theme+'-warning-controls-detail.png')
(out/'comparison-facts.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print('facts',sha(out/'comparison-facts.json'),'boards',len(list(out.glob('*.png')))); print('styleDiffs',[(v['key'], {k:[x['currentStyleDifferences']for x in a]for k,a in v['compare'].items()if any(x['currentStyleDifferences']for x in a)})for v in rows])
