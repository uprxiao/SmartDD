"""F19 synthetic DOCX inputs and independent Poppler/stdlib PDF oracle."""
from pathlib import Path
import datetime,hashlib,json,re,shutil,subprocess,sys,tempfile,xml.etree.ElementTree as ET,zipfile
sha=lambda b:hashlib.sha256(b).hexdigest()
def source_info(path):
 with zipfile.ZipFile(path)as z:
  names=z.namelist();parts={n:sha(z.read(n))for n in names};document=z.read('word/document.xml').decode();styles=z.read('word/styles.xml').decode()
 return {'sha256':sha(Path(path).read_bytes()),'names':names,'parts':parts,'hasRevisions':'<w:ins 'in document or'<w:del 'in document,'declaredFonts':re.findall(r'w:(?:ascii|eastAsia)="([^"]+)"',styles),'features':['2pages','table2x2','64x32greenPNG-at144x72pt','header/footer','Chinese text','comments/anchors','unknownXML']}
def command(args):
 r=subprocess.run(args,capture_output=True,text=True,timeout=30);assert r.returncode==0,(args,r.stderr);return r.stdout
if len(sys.argv)>1 and sys.argv[1]=='verify':
 source,pdf,out=map(Path,sys.argv[2:5]);out.mkdir(exist_ok=True,parents=True);info=source_info(source)
 for tool in ['pdftotext','pdfinfo','pdffonts','pdfimages']:assert shutil.which(tool),tool
 bbox=out/'text.html';command(['pdftotext','-bbox-layout','-enc','UTF-8',str(pdf),str(bbox)]);root=ET.parse(bbox).getroot();ns={'x':'http://www.w3.org/1999/xhtml'};pages=[]
 for p in root.findall('.//x:page',ns):
  words=[dict(text=w.text or'',**{k:float(v)for k,v in w.attrib.items()})for w in p.findall('.//x:word',ns)];pages.append({'width':float(p.get('width')),'height':float(p.get('height')),'words':words,'text':' '.join(w['text']for w in words)})
 assert len(pages)==2,[(p['width'],p['height'],p['text'])for p in pages]
 joined=[''.join(w['text']for w in p['words'])for p in pages]
 for token in ['J11COMPLEXORIGINAL','中文','TABLEA1','TABLEB1','TABLEA2','TABLEB2','INSERTEDORIGINAL']:assert token in joined[0],(token,joined[0])
 assert 'J11SECONDPAGEORIGINAL'in joined[1];assert ('DELETEDORIGINAL'in joined[0])==info['hasRevisions']
 for text in joined:assert 'J11HEADERORIGINAL'in text and'J11FOOTERORIGINAL'in text,text
 assert all(abs(p['width']-595.3)<1 and abs(p['height']-841.9)<1 for p in pages)
 def word(text,page=0):return next(w for w in pages[page]['words']if w['text']==text)
 a,b=word('A1'),word('B1');assert abs((b['xMin']-a['xMin'])-225)<2,(a,b)
 assert abs(a['yMin']-b['yMin'])<1;assert word('A2')['yMin']>a['yMin'];assert word('B2')['yMin']>b['yMin']
 assert word('HEADER')['yMin']<word('COMPLEX')['yMin'];assert word('FOOTER')['yMin']>word('A2')['yMin']
 font_text=command(['pdffonts',str(pdf)]);(out/'fonts.txt').write_text(font_text);font_rows=[line.split()for line in font_text.splitlines()[2:]if line.strip()];assert font_rows
 images=command(['pdfimages','-list',str(pdf)]);(out/'images.txt').write_text(images);command(['pdfimages','-f','1','-l','1',str(pdf),str(out/'image')])
 green=[]
 for p in sorted(out.glob('image-*.ppm')):
  data=p.read_bytes();m=re.match(rb'P6\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+(\d+)\s',data)
  if m and tuple(map(int,m.groups()))==(64,32,255):
   pixels=data[m.end():];assert len(pixels)==64*32*3;assert set(tuple(pixels[i:i+3])for i in range(0,len(pixels),3))=={(25,150,110)};green.append({'file':p.name,'width':64,'height':32,'allPixels':[25,150,110]})
 assert green,'Source green image missing/corrupted in actual PDF'
 result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':str(source),'sourceInfo':info,'pdf':str(pdf),'pdfSha256':sha(pdf.read_bytes()),'pages':pages,'fonts':font_rows,'fontDetails':font_text,'imageDetails':images,'greenImages':green,'comparisons':{'pagesA4':True,'allTableCellsAndChinese':True,'columns225pt':True,'headerFooterBothPages':True,'revisionTextMatchesSource':True,'originalGreenPNGExact':True},'limits':['No MSWord/Codex pixel equivalence','Declared font names versus actual embedded PDF names recorded; substitution may occur','Comments and revision XML untouched, not acceptance/rejection or editable writeback claim']};(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False));sys.exit()
base=Path(tempfile.mkdtemp(prefix='willyou-docx-preview-',dir='/private/tmp'));project=base/'project';project.mkdir();template=json.loads(subprocess.check_output([sys.executable,'scripts/files/text-writeback-fixtures.py'],text=True));original=Path(template['project'])/'complex.docx'
with zipfile.ZipFile(original)as z:entries=[(x,z.read(x.filename))for x in z.infolist()]
cases=[]
for name,mode in [('revisions.docx','source-revisions'),('font-fallback.docx','missing-font'),('clean.docx','generated-clean-comparison')]:
 target=project/name
 with zipfile.ZipFile(target,'w')as z:
  for item,data in entries:
   if mode=='missing-font'and item.filename=='word/styles.xml':data=data.replace(b'Liberation Sans',b'WillYouF19MissingLatin').replace(b'Noto Sans CJK SC',b'WillYouF19MissingCJK')
   if mode=='generated-clean-comparison'and item.filename=='word/document.xml':
    text=data.decode();text=re.sub(r'<w:del\b[^>]*>.*?</w:del>','',text,flags=re.S);text=re.sub(r'</?w:ins\b[^>]*>','',text);data=text.encode()
   z.writestr(item,data)
 cases.append({'name':name,'mode':mode,'info':source_info(target)})
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'project':str(project),'cases':cases,'templateManifest':str(Path(template['base'])/'fixtures.json'),'boundary':'Own genuine DOCX template reused from J11. Missing-font and clean variants are generated inputs, not App edit/accept-revision actions. Independent stdlib ZIP/XML source oracle plus installed Poppler PDF text/geometry/fonts/images; generated source never user documents.'};(base/'fixtures.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
