"""F20 synthetic PPTX with a real image/animation; independent ZIP and Poppler oracle."""
from pathlib import Path
import datetime,hashlib,json,re,struct,subprocess,sys,tempfile,xml.etree.ElementTree as ET,zipfile,zlib
sha=lambda b:hashlib.sha256(b).hexdigest()
def source_info(path):
 with zipfile.ZipFile(path)as z:
  names=z.namelist();parts={n:sha(z.read(n))for n in names};slide=z.read('ppt/slides/slide2.xml').decode()
 return {'sha256':sha(Path(path).read_bytes()),'names':names,'parts':parts,'hasAnimation':'<p:timing' in slide,'hasTransition':'<p:transition' in slide}
def command(args):
 r=subprocess.run(args,capture_output=True,text=True,timeout=30);assert r.returncode==0,(args,r.stderr);return r.stdout
if len(sys.argv)>1 and sys.argv[1]=='verify':
 source,pdf,out=map(Path,sys.argv[2:5]);out.mkdir(parents=True,exist_ok=True);info=source_info(source)
 bbox=out/'text.html';command(['pdftotext','-bbox-layout',str(pdf),str(bbox)]);ns={'x':'http://www.w3.org/1999/xhtml'};pages=[]
 for p in ET.parse(bbox).getroot().findall('.//x:page',ns):
  words=[dict(text=w.text or'',**{k:float(v)for k,v in w.attrib.items()})for w in p.findall('.//x:word',ns)];pages.append({'width':float(p.get('width')),'height':float(p.get('height')),'words':words,'text':' '.join(w['text']for w in words)})
 assert len(pages)==2,pages
 joined=[''.join(w['text']for w in p['words'])for p in pages]
 for token in ['MASTER_TITLE','Label','Value','TABLE_OLD','UNCHANGED_CELL','A','B']:assert token in joined[0],(token,joined)
 for token in ['OTHER_SLIDE','UNCHANGED_SLIDE']:assert token in joined[1],(token,joined)
 assert all(abs(p['width']-720)<1 and abs(p['height']-405)<1 for p in pages)
 images=command(['pdfimages','-list',str(pdf)]);(out/'images.txt').write_text(images);command(['pdfimages','-f','2','-l','2',str(pdf),str(out/'image')]);roles={int(v[1]):v[2]for line in images.splitlines()[2:]if len(v:=line.split())>=5};green=[]
 for p in sorted(out.glob('image-*.ppm')):
  data=p.read_bytes();m=re.match(rb'P6\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+(\d+)\s',data)
  if m and tuple(map(int,m.groups()))==(64,32,255):
   pixels=data[m.end():];number=int(re.search(r'image-(\d+)',p.name).group(1));assert len(pixels)==6144
   if roles[number]=='image':assert set(tuple(pixels[i:i+3])for i in range(0,len(pixels),3))=={(25,150,110)};green.append({'file':str(p),'allPixels':[25,150,110]})
   elif roles[number]=='smask':assert set(pixels)=={255}
 assert green,'Missing or changed original source PNG'
 fonts=command(['pdffonts',str(pdf)]);(out/'fonts.txt').write_text(fonts)
 result={'sourceInfo':info,'pdf':str(pdf),'pdfSha256':sha(pdf.read_bytes()),'pages':pages,'fonts':fonts,'imageDetails':images,'greenImages':green,'comparisons':{'twoPages16by9':True,'textAndTableContent':True,'imageExactRGB':True,'animationAndTransitionRemainInSource':info['hasAnimation']and info['hasTransition']},'limits':['PDF is static; animation/transition not executed','No PowerPoint or Codex pixel-equivalence claim']};(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False));sys.exit()
base=Path(tempfile.mkdtemp(prefix='willyou-pptx-preview-',dir='/private/tmp'));project=base/'project';project.mkdir()
def chunk(kind,data):return struct.pack('!I',len(data))+kind+data+struct.pack('!I',zlib.crc32(kind+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',64,32,8,6,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+bytes([25,150,110,255])*64)*32))+chunk(b'IEND',b'')
template=Path('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.pptx')
with zipfile.ZipFile(template)as z:entries=[(x,z.read(x.filename))for x in z.infolist()]
pic='<p:pic><p:nvPicPr><p:cNvPr id="20" name="F20 original green image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdF20Image"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="5943600" y="3429000"/><a:ext cx="1828800" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>'
animation='<p:transition spd="slow"><p:fade/></p:transition><p:timing><p:tnLst><p:par><p:cTn id="1"><p:childTnLst><p:set><p:cBhvr><p:cTn id="2"/><p:tgtEl><p:spTgt spid="20"/></p:tgtEl></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>'
cases=[]
for name,readonly in [('content.pptx',False),('readonly.pptx',True)]:
 path=project/name
 with zipfile.ZipFile(path,'w')as z:
  for item,data in entries:
   if item.filename=='ppt/slides/slide2.xml':data=data.decode().replace('</p:spTree>',pic+'</p:spTree>').replace('</p:sld>',animation+'</p:sld>').encode()
   if item.filename=='ppt/slides/_rels/slide2.xml.rels':data=data.decode().replace('</Relationships>','<Relationship Id="rIdF20Image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/f20.png"/></Relationships>').encode()
   if item.filename=='[Content_Types].xml' and b'Extension="png"'not in data:data=data.decode().replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>').encode()
   z.writestr(item,data)
  z.writestr('ppt/media/f20.png',png)
 cases.append({'name':name,'readonly':readonly,'info':source_info(path)})
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'project':str(project),'cases':cases,'template':str(template),'boundary':'Own synthetic genuine OOXML, table/chart/notes/master reused; added green PNG, fade transition and timing on second slide. readonly is an intended real filesystem mode, not a simulated App host.'};(base/'fixtures.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
