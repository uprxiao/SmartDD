import json,hashlib,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageChops
repo=Path('/Users/liubu/hx/4.uprxiao/SmartDD'); run=Path('/private/tmp/willyou-m16-b09-c24-profile-clone-final-pair-YtctLO'); out=run/'derived-review'; out.mkdir(exist_ok=True)
orig=repo/'docs/里程碑/M12_浏览器自动化/验收/证据/并行测试/M12-20261103T154320Z-bff2/M12-T145'
data=json.loads((run/'B09-C24-final-clone-source-selected-result.json').read_text())
old9=json.loads((orig/'App048-normal9-R003-independent-original-review/review-original9.json').read_text())
fifteen=json.loads((orig/'App051-normal15-currentP48-review/image-index.json').read_text())
p48=orig/'P48-source060-profile-confirm-current'
pmanifest={x['path']:x for x in json.loads((p48/'archive-manifest.json').read_text())['members']}
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def check(p,h):
    assert sha(p)==h,(str(p),sha(p),h)
    return p
def ref(p): return {'path':str(p.relative_to(repo)) if p.is_relative_to(repo) else str(p),'sha256':sha(p),'bytes':p.stat().st_size}
def img(p,size=None): 
    im=Image.open(p).convert('RGB')
    if size: im=im.resize(size,Image.Resampling.LANCZOS)
    return im
def labelboard(items,cols,name,maxsize=None):
    pix=[(s,x if maxsize is None else x.resize(maxsize,Image.Resampling.LANCZOS)) for s,x in items]
    w=max(im.width for _,im in pix);h=max(im.height for _,im in pix); gap=12; title=26
    board=Image.new('RGB',(gap+cols*(w+gap),gap+math.ceil(len(pix)/cols)*(h+gap+title)),(247,247,247));d=ImageDraw.Draw(board)
    font=ImageFont.load_default()
    for i,(s,x) in enumerate(pix):
        ox=gap+(i%cols)*(w+gap);oy=gap+(i//cols)*(h+gap+title)
        d.text((ox,oy+5),s,fill='black',font=font);board.paste(x,(ox,oy+title))
    f=out/name;board.save(f);return f
def crop(im,d,margin=10):
    return im.crop((math.floor(d['x'])-margin,math.floor(d['y'])-margin,math.ceil(d['right'])+margin,math.ceil(d['bottom'])+margin))
refs=[]; shellboards={}
for key in data['matrixKeys']:
    canonical=key.split('|')[0];name='A-'+canonical+'-B12-profiles-clone'; pname='P-'+canonical+'-B12-profiles-clone'; width=int(canonical.split('-rw')[1].split('-')[0]);theme=canonical.split('-')[0]
    cs=[c for c in data['captures'] if c['originalKey']==key];assert len(cs)==2
    old,new=next(c for c in cs if c['combo'].startswith('old-clean-')),next(c for c in cs if c['combo'].startswith('new-'))
    for c in [old,new]:
        f=check(Path(c['shell']['file']),c['shell']['sha']);assert Image.open(f).size==(2880,1800) 
    oldrow=next((x for x in old9['pairs'] if x['key']==key),None);newrow=next((x for x in fifteen['pairs'] if x['key']==key),None)
    assert (oldrow is None)!=(newrow is None)
    if oldrow:
        af=orig/'App048-normal24-R003-valid9-focus-yield'/f'{name}.png'
        ameta=af.with_suffix('.json')
        check(af,oldrow['A']['sha256']);check(ameta,oldrow['A']['metadata']['sha256'])
    else:
        af=orig/'App051-normal15-R004-valid13-focus-yield'/f'{name}.png';ameta=af.with_suffix('.json')
        check(af,newrow['A']['sha256']);check(ameta,newrow['A']['metadataSHA256'])
    pf=p48/'images'/f'{pname}.png';pmeta=pf.with_suffix('.json')
    check(pf,pmanifest[str(pf.relative_to(p48))]['sha256']);check(pmeta,pmanifest[str(pmeta.relative_to(p48))]['sha256'])
    ap=json.loads(ameta.read_text())['profile'];pr=data['finalCloneTargets'][key]['rect']
    assert ap['selectedLabel']==ap['heading']=='项目登录态'
    assert [ [x['label'],x['scope'],x['selected']] for x in ap['options'] ]==new['finalCloneSelection']['options']
    assert [[a['text'],a['disabled']] for a in ap['actions']]==new['finalCloneSelection']['actions']
    ai=img(af);pi=img(pf);oi=img(Path(old['shell']['file']),(1440,900));ni=img(Path(new['shell']['file']),(1440,900));assert ai.size==pi.size==(1440,900)
    files=[]
    sources=[('Latest accepted App048 or App051',ai,ap['dialog']['rect']),('Frozen pre-M16 App, actual',oi,old['context']['dialog']),('Final P48 reference',pi,pr),('C24 actual, source remains selected',ni,new['context']['dialog'])]
    files.append(labelboard([(s,crop(im,d)) for s,im,d in sources],2,canonical+'-dialog-review.png'))
    shellboards.setdefault(theme,[]).extend([(canonical+' frozen old actual',oi),(canonical+' C24 actual',ni)])
    od=Image.open(old['shell']['file']).convert('RGB');nd=Image.open(new['shell']['file']).convert('RGB');pix=ImageChops.difference(od,nd)
    # Compare surrounding areas of same fixture; overlay and modal differ inside actual panel only.
    panel=new['geometry']['panel'];px=int(panel['x']*2);pt=int(panel['y']*2);pright=int((panel['x']+panel['width'])*2)
    differences={'globalDiffBBoxRaw':pix.getbbox(),'leftOfActualPanel':pix.crop((0,0,px,1800)).getbbox(),'aboveActualPanel':pix.crop((px,0,2880,pt)).getbbox(),'rightOfActualPanel':pix.crop((pright,0,2880,1800)).getbbox(), 'exactShellSHA':new['shell']['sha']==old['shell']['sha']}
    fields=['fontSize','lineHeight','borderWidth','borderColor','borderRadius','color','backgroundColor','fontFamily','fontWeight','padding','gap','whiteSpace','overflowWrap','display','flexWrap']
    compare=[]
    for a,b,c in zip(ap['actions'],old['profile']['actions'],new['profile']['actions']):
        assert a['text']==b['text']==c['text']
        diff={f:[a['style'].get(f),c['style'].get(f)] for f in fields if a['style'].get(f)!=c['style'].get(f)}
        compare.append({'label':a['text'],'AwidthHeight':[a['rect']['width'],a['rect']['height']],'oldWidthHeight':[b['rect']['width'],b['rect']['height']],'C24widthHeight':[c['rect']['width'],c['rect']['height']], 'targetVsC24Diff':diff,'oldExplicitStyles':{x:b['style'].get(x) for x in ['fontSize','lineHeight','borderWidth','borderRadius','borderColor','color','backgroundColor']}, 'C24ExplicitStyles':{x:c['style'].get(x) for x in ['fontSize','lineHeight','borderWidth','borderRadius','borderColor','color','backgroundColor']}})
    refs.append({'key':key,'latestOriginalA':ref(af),'latestOriginalAMetadata':ref(ameta),'finalP48Image':ref(pf),'finalP48Metadata':ref(pmeta),'reviewBoard':str(files[0]),'originalDialog':ap['dialog']['rect'],'P48Dialog':pr,'oldDialog':old['context']['dialog'],'C24Dialog':new['context']['dialog'],'actualOptionFacts':new['finalCloneSelection'],'actionComparisons':compare,'latestOriginalCloseStyle':ap['allVisibleButtons'][0]['style'],'originalRootTypography':[ap['dialog']['style']['fontSize'],ap['dialog']['style']['lineHeight']], 'C24RootTypography':[new['profile']['dialog']['style']['fontSize'],new['profile']['dialog']['style']['lineHeight']], 'originalActualInlineStatuses':len(ap['statuses']),'C24ActualInlineStatuses':len(new['profile']['statuses']),'C24CloseStyle':new['context']['close']['style'],'diffRegions':differences})
for t,items in shellboards.items():labelboard(items,2,t+'-actual-full-shell-overview.png',(720,450))
(out/'visual-comparison-source-facts.json').write_text(json.dumps(refs,ensure_ascii=False,indent=2)+'\n')
print(json.dumps([{'key':x['key'],'oldDialog':[x['oldDialog']['width'],x['oldDialog']['height']], 'newDialog':[x['C24Dialog']['width'],x['C24Dialog']['height']], 'actionDiffs':[(a['label'],a['AwidthHeight'],a['oldWidthHeight'],a['C24widthHeight'],a['targetVsC24Diff']) for a in x['actionComparisons']], 'diffRegions':x['diffRegions']} for x in refs],ensure_ascii=False))
