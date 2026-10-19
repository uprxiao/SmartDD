"""Read-only OOXML oracle plus all speaker note bodies and durable draft metadata."""
import contextlib,hashlib,io,json,runpy,sys,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
path=Path(sys.argv[1]);ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
if path.name=='journal.json':
 journal=json.loads(path.read_text());draft=path.parent/journal['draftLeaf'];raw=draft.read_bytes();assert hashlib.sha256(raw).hexdigest()==journal['draftHash'];magic=raw.index(b'\n')+1;length=int.from_bytes(raw[magic:magic+4],'little');header=json.loads(raw[magic+4:magic+4+length]);body=raw[magic+4+length:];assert len(body)==header['bytes']
 with zipfile.ZipFile(io.BytesIO(body))as z:parts={name:z.read(name).decode('utf8',errors='replace')for name in z.namelist()if name.endswith('.xml')}
 print(json.dumps({'path':str(path),'journal':journal,'draftSha256':hashlib.sha256(raw).hexdigest(),'magic':raw[:magic].decode(),'header':header,'xmlText':{name:''.join(ET.fromstring(xml).itertext())for name,xml in parts.items()}},ensure_ascii=False));sys.exit(0)
stream=io.StringIO()
with contextlib.redirect_stdout(stream):runpy.run_path(str(Path(__file__).with_name('verify-office-ack.py')))
out=json.loads(stream.getvalue())
if path.suffix=='.pptx':
 with zipfile.ZipFile(path)as z:
  notes={}
  for name in z.namelist():
   if name.startswith('ppt/notesSlides/notesSlide')and name.endswith('.xml'):
    root=ET.fromstring(z.read(name));bodies=[]
    for shape in root.findall('.//p:sp',ns):
     ph=shape.find('p:nvSpPr/p:nvPr/p:ph',ns)
     if ph is not None and ph.get('type')=='body':bodies.extend(''.join(t.text or ''for t in para.findall('.//a:t',ns))for para in shape.findall('.//a:p',ns))
    notes[name]=bodies
  out['notes']=notes
print(json.dumps(out,ensure_ascii=False))
