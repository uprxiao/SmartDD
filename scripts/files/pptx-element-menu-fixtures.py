"""W14 owned OOXML drawing order + real unsupported field text preparation."""
from pathlib import Path
import hashlib,json,re,subprocess,sys,zipfile,xml.etree.ElementTree as E
P='http://schemas.openxmlformats.org/presentationml/2006/main'
A='http://schemas.openxmlformats.org/drawingml/2006/main'
def inspect(path):
    with zipfile.ZipFile(path) as z:
        names=z.namelist();tree=E.fromstring(z.read('ppt/slides/slide1.xml')).find('.//{'+P+'}spTree')
        objects=[]
        for node in tree:
            if node.tag!='{'+P+'}sp':continue
            prop=node.find('./{'+P+'}nvSpPr/{'+P+'}cNvPr')
            objects.append({'id':prop.get('id'),'name':prop.get('name'),'text':'\n'.join(''.join(t.text or ''for t in p.iter('{'+A+'}t'))for p in node.findall('.//{'+A+'}p')),'field':bool(node.findall('.//{'+A+'}fld'))})
        raw=z.read('ppt/slides/slide1.xml');drawing_hashes={re.search(rb'<p:cNvPr\b[^>]*\bid="([0-9]+)"',node)[1].decode():hashlib.sha256(node).hexdigest()for node in re.findall(rb'<p:sp>.*?</p:sp>',raw,re.S)}
        return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'names':names,'parts':{name:hashlib.sha256(z.read(name)).hexdigest()for name in names},'objects':objects,'drawingHashes':drawing_hashes}
if sys.argv[1]=='inspect':print(json.dumps(inspect(Path(sys.argv[2])),ensure_ascii=False));sys.exit(0)
root=Path(sys.argv[1]).resolve();assert str(root).startswith(('/private/tmp/willyou-pptx-shortcuts-elements-A-','/private/tmp/willyou-pptx-shortcuts-elements-I-'))
base=json.loads(subprocess.check_output(['python3','scripts/files/pptx-notes-fixtures.py',str(root)],text=True))
shapes=[]
for index,name in enumerate(['Layer A','Layer Target','Layer C','Field Blocker']):
    content=f'<a:fld id="{{22222222-2222-2222-2222-222222222222}}" type="slidenum"><a:t>ORIGINAL_FIELD</a:t></a:fld>' if index==3 else f'<a:r><a:rPr sz="2000"/><a:t>{name}</a:t></a:r>'
    shapes.append(f'<p:sp><p:nvSpPr><p:cNvPr id="{201+index}" name="{name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{(30+(index%3)*210)*12700}" y="{(100+(index//3)*150)*12700}"/><a:ext cx="{180*12700}" cy="{90*12700}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="EEFAF4"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p>{content}</a:p></p:txBody></p:sp>')
rows=[]
for item in base['cases']:
    path=root/item['name'];mode=path.stat().st_mode&0o777;path.chmod(0o600)
    with zipfile.ZipFile(path)as z:parts=[(info,z.read(info))for info in z.infolist()]
    updated=[]
    for info,content in parts:
        if info.filename=='ppt/slides/slide1.xml':
            match=re.search(rb'<p:spTree>(.*?)</p:spTree>',content,re.S);assert match
            body=match[1];group=re.search(rb'(<p:nvGrpSpPr>.*?</p:nvGrpSpPr>\s*<p:grpSpPr(?:\s[^>]*)?(?:/>|>.*?</p:grpSpPr>))',body,re.S);assert group
            content=content[:match.start(1)]+group[1]+''.join(shapes).encode()+content[match.end(1):]
        updated.append((info,content))
    with zipfile.ZipFile(path,'w')as z:
        for info,content in updated:z.writestr(info,content)
    path.chmod(mode);result=inspect(path);assert [o['id']for o in result['objects']]==['201','202','203','204'];rows.append({'name':item['name'],'mode':item['mode'],'theme':item['theme'],**result})
print(json.dumps({'project':str(root),'cases':rows,'boundary':'Own curated source copies only. Initial slide1 drawings deliberately replaced with3normal text shapes +1genuine field. This setup is not an acceptance edit. Other package parts retained.'},ensure_ascii=False))
