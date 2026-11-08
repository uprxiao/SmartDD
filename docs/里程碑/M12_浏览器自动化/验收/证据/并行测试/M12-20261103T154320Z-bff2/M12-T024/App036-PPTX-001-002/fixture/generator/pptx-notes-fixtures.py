"""Own W10 copies and independent ZIP/XML note bodies; never edits user files."""
import hashlib,json,posixpath,re,sys,zipfile,xml.etree.ElementTree as E
from pathlib import Path
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
def inspect(path):
 with zipfile.ZipFile(path) as z:
  names=z.namelist();notes={}
  for n in names:
   if n.startswith('ppt/notesSlides/') and '/_rels/' not in n and n.endswith('.xml'):
    root=E.fromstring(z.read(n));rows=[]
    for sp in root.findall('.//p:sp',ns):
     ph=sp.find('p:nvSpPr/p:nvPr/p:ph',ns)
     if ph is not None and ph.get('type')=='body':rows.extend(''.join(t.text or '' for t in para.findall('.//a:t',ns)) for para in sp.findall('.//a:p',ns))
    notes[n]='\n'.join(rows)
  slide_notes=[]
  for slide in sorted((n for n in names if re.fullmatch(r'ppt/slides/slide[0-9]+\.xml',n)),key=lambda n:int(re.search(r'slide([0-9]+)',n)[1])):
   rel=posixpath.dirname(slide)+'/_rels/'+posixpath.basename(slide)+'.rels';bodies=[]
   if rel in names:
    for node in E.fromstring(z.read(rel)):
     if node.get('Type','').endswith('/notesSlide'):
      target=posixpath.normpath(posixpath.join(posixpath.dirname(slide),node.get('Target')));assert target in notes; bodies.append(notes[target])
   assert len(bodies)<=1;slide_notes.append(bodies[0] if bodies else '')
  return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'names':names,'parts':{n:hashlib.sha256(z.read(n)).hexdigest() for n in names},'notes':notes,'slideNotes':slide_notes}
if sys.argv[1]=='inspect':print(json.dumps(inspect(Path(sys.argv[2])),ensure_ascii=False));sys.exit(0)
root=Path(sys.argv[1]).resolve();assert str(root).startswith(('/private/tmp/willyou-pptx-notes-','/private/tmp/willyou-pptx-shortcuts-'));root.mkdir(parents=True,exist_ok=True)
source=Path('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.pptx')
rows=[]
for theme in ['light','dark']:
 for mode in ['readonly','editable']:
  path=root/(theme+'-'+mode+'.pptx');path.write_bytes(source.read_bytes())
  if mode=='readonly':path.chmod(0o444)
  row={'name':path.name,'mode':mode,'theme':theme,**inspect(path)};assert row['notes']['ppt/notesSlides/notesSlide1.xml']=='SLIDE_ONE_NOTES';assert 'ppt/notesSlides/notesSlide2.xml' not in row['names'];rows.append(row)
print(json.dumps({'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'project':str(root),'cases':rows},ensure_ascii=False))
