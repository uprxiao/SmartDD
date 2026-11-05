"""Evidence-only bounded crop/contact sheets. Run only after root releases Native.
No App, browser, inspector, OS probe, network, input, source/package writes.
Exact source pixels are cropped/pasted without scaling or modifying originals.
"""
from pathlib import Path
import json,hashlib,math,argparse,struct

ROOT=Path('/private/tmp/willyou-m12-p075-visual-review-001')
INDEX=ROOT/'index.json'

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--render',action='store_true',required=True)
    parser.add_argument('--group',choices=['all']+[f'{theme}-{n}'for theme in ['ylight','ydark']for n in range(4)],default='all')
    args=parser.parse_args()
    index=json.loads(INDEX.read_text());source=Path(index['sourceRoot'])
    assert source==Path('/private/tmp/willyou-m12-navigation-settings-app-004')
    assert hashlib.sha256((source/'manifest.json').read_bytes()).hexdigest()==index['sourceManifestSha256']
    assert hashlib.sha256((Path(index['tab005Root'])/'manifest.json').read_bytes()).hexdigest()==index['tab005ManifestSha256']
    # Deliberately defer image decoder imports until explicit authorized render.
    from PIL import Image,ImageDraw,ImageFont,ImageChops
    output=ROOT/'sheets-001';output.mkdir(exist_ok=True)
    result={'indexSha256':hashlib.sha256(INDEX.read_bytes()).hexdigest(),'derivativeOnly':True,'originalsUnchanged':True,'groups':[],'boundary':'Contact sheet labels and margins are added outside exact original-pixel crops. No resizing, retouch, color change, product pass, or simulated state. Inspect original PNG for wider context.'}
    for theme in ['ylight','ydark']:
        theme_rows=[e for e in index['entries']if e['theme']==theme]
        for group_number in range(4):
            group=f'{theme}-{group_number}'
            if args.group not in ['all',group]:continue
            destination=output/(group+'.png');metadata=output/(group+'.json')
            assert not destination.exists()and not metadata.exists(),'Existing derivative group is frozen; do not overwrite'
            entries=theme_rows[group_number*3:(group_number+1)*3];crops=[];crop_rows=[]
            for entry in entries:
                context=entry['cropContextCss'];pad_x=12;pad_y=10
                box=(max(0,math.floor((context['x']-pad_x)*2)),max(0,math.floor((context['y']-pad_y)*2)),min(2800,math.ceil((context['x']+context['width']+pad_x)*2)),min(1800,math.ceil((context['y']+context['height']+pad_y)*2)))
                state_crops=[];state_rows=[]
                for state in ['baseline','hover','focus','pressed']:
                    evidence=entry['pictures'][state];name=evidence['path'];assert Path(name).name==name and name.startswith('T147-')
                    original=source/name;before=original.read_bytes();assert hashlib.sha256(before).hexdigest()==evidence['sha256']
                    with Image.open(original)as image:
                        assert image.size==(2800,1800)
                        crop=image.crop(box).convert('RGB');state_crops.append(crop)
                    assert hashlib.sha256(original.read_bytes()).hexdigest()==evidence['sha256']
                    state_rows.append({'state':state,'source':name,'sourceSha256':evidence['sha256'],'cropPixelBox':box,'geometrySource':entry['geometrySource']})
                changes={}
                for a,b in [('baseline','hover'),('hover','focus'),('hover','pressed')]:
                    ia=['baseline','hover','focus','pressed'].index(a);ib=['baseline','hover','focus','pressed'].index(b)
                    bbox=ImageChops.difference(state_crops[ia],state_crops[ib]).getbbox()
                    changes[a+'To'+b]={'anyExactPixelDifference':bbox is not None,'changedPixelBoundingBox':bbox,'boundary':'Supporting pixel difference only, no automatic visible-state or keyboard-focus acceptance.'}
                crops.append(state_crops);crop_rows.append({'id':entry['id'],'label':entry['label'],'states':state_rows,'pixelDifferences':changes,'focusEvidenceCaveat':entry['focusEvidenceCaveat']})
            cell_width=max(c.width for row in crops for c in row)+24
            row_heights=[max(c.height for c in row)+56 for row in crops]
            sheet=Image.new('RGB',(cell_width*4,sum(row_heights)+48),'#D7D7D7');draw=ImageDraw.Draw(sheet);font=ImageFont.load_default()
            draw.text((8,6),f'DERIVED EVIDENCE CROPS / {group} / exact original pixels, no scale',fill='black',font=font)
            for i,state in enumerate(['baseline','hover','focus','pressed']):draw.text((i*cell_width+8,26),state,fill='black',font=font)
            y=48
            for row_number,(entry,row)in enumerate(zip(entries,crops)):
                for column,crop in enumerate(row):
                    x=column*cell_width+8;draw.text((x,y+3),entry['id']+' / source index.json',fill='black',font=font);sheet.paste(crop,(x,y+22))
                y+=row_heights[row_number]
            sheet.save(destination)
            content={'group':group,'image':destination.name,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest(),'rows':crop_rows,'canvasPixels':sheet.size,'notOriginalScreenshot':True}
            metadata.write_text(json.dumps(content,ensure_ascii=False,indent=2)+'\n');result['groups'].append(content)
            for row in crops:
                for crop in row:crop.close()
            sheet.close()
    summary=output/('render-'+args.group+'.json');assert not summary.exists();summary.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'groups':[x['group']for x in result['groups']],'output':str(output),'originalsUnchanged':True,'formalCaseIncrement':0}))

if __name__=='__main__':main()
