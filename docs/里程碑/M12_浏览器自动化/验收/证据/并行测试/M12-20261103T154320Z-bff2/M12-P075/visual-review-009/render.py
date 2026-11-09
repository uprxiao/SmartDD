from pathlib import Path
import json,hashlib,math
from PIL import Image,ImageDraw,ImageFont,ImageChops
ROOT=Path('/private/tmp/willyou-m12-p075-visual-review-002')
index=json.loads((ROOT/'index.json').read_text());source=Path(index['sourceRoot']);assert source==Path('/private/tmp/willyou-m12-navigation-settings-app-009')
assert hashlib.sha256((source/'manifest.json').read_bytes()).hexdigest()==index['sourceManifestSha256']
output=ROOT/'sheets';output.mkdir();entries={e['id']:e for e in index['entries']};reports=[]
for group in index['groups']:
    rows=[];metadata=[]
    for ident in group['entries']:
        entry=entries[ident];crops=[];states=[]
        for state in group['columns']:
            picture=entry['pictures'][state];original=source/picture['path'];before=original.read_bytes();assert hashlib.sha256(before).hexdigest()==picture['sha256']
            rect=picture['rectCss'];pad=12;box=(max(0,math.floor((rect['x']-pad)*2)),max(0,math.floor((rect['y']-pad)*2)),min(2800,math.ceil((rect['x']+rect['width']+pad)*2)),min(1800,math.ceil((rect['y']+rect['height']+pad)*2)))
            with Image.open(original)as image:
                assert image.size==(2800,1800)
                if image.mode=='RGBA':assert image.getchannel('A').getextrema()==(255,255),'No opacity compositing of evidence'
                crop=image.crop(box).convert('RGB');crops.append(crop)
            assert hashlib.sha256(original.read_bytes()).hexdigest()==picture['sha256']
            states.append({'state':state,'original':picture['path'],'originalSha256':picture['sha256'],'measuredRectCss':rect,'cropPixelBox':box})
        differences=[]
        for i in range(1,len(crops)):
            differences.append({'before':group['columns'][0],'after':group['columns'][i],'differenceBounds':ImageChops.difference(crops[0],crops[i]).getbbox()if crops[0].size==crops[i].size else'size-diff-not-comparable','boundary':'Supporting pixel difference only; actual visible state requires independent review.'})
        rows.append(crops);metadata.append({'id':ident,'label':entry['label'],'states':states,'differences':differences})
    cell_width=max(c.width for row in rows for c in row)+20;row_heights=[max(c.height for c in row)+44 for row in rows]
    sheet=Image.new('RGB',(cell_width*len(group['columns']),sum(row_heights)+42),'#D7D7D7');draw=ImageDraw.Draw(sheet);font=ImageFont.load_default()
    draw.text((6,4),'DERIVED EVIDENCE / '+group['id']+' / exact original pixels, no scaling',fill='black',font=font)
    for n,state in enumerate(group['columns']):draw.text((n*cell_width+6,22),state+' (before = pure hover)',fill='black',font=font)
    y=42
    for entry_id,crops,height in zip(group['entries'],rows,row_heights):
        for n,crop in enumerate(crops):draw.text((n*cell_width+6,y+2),entry_id,fill='black',font=font);sheet.paste(crop,(n*cell_width+6,y+20))
        y+=height
    destination=output/(group['id']+'.png');sheet.save(destination);report={'group':group['id'],'image':destination.name,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'pixels':sheet.size,'rows':metadata,'derivativeNotOriginal':True};(output/(group['id']+'.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');reports.append(report)
    for row in rows:
        for crop in row:crop.close()
    sheet.close()
(ROOT/'render-result.json').write_text(json.dumps({'groups':reports,'originalsUnchanged':True,'originalCount':76,'AppOrOSOrUIStarted':False,'formalCaseIncrement':0,'boundary':'Exact originalpixelcrops and externallyaddedlabels only, no resize/retouch/color/opacitycomposition; no actual UI pass automaticallydeclared.'},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'groups':len(reports),'originalsUnchanged':True,'originalCount':76,'formalCaseIncrement':0}))
