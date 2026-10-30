"""W13 own normal/hidden slides; independent relationship and ZIP verification."""
from pathlib import Path
import sys,subprocess,json,zipfile,hashlib,posixpath,re,xml.etree.ElementTree as E
P='http://schemas.openxmlformats.org/presentationml/2006/main';R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';A='http://schemas.openxmlformats.org/drawingml/2006/main'
def inspect(path):
 with zipfile.ZipFile(path)as z:
  names=z.namelist();links={n.get('Id'):n.get('Target')for n in E.fromstring(z.read('ppt/_rels/presentation.xml.rels'))};slides=[]
  for node in E.fromstring(z.read('ppt/presentation.xml')).find('{'+P+'}sldIdLst'):
   target=links[node.get('{'+R+'}id')];part=posixpath.normpath(posixpath.join('ppt',target)) if not target.startswith('/')else target.lstrip('/');xml=E.fromstring(z.read(part));notes='';rel=posixpath.dirname(part)+'/_rels/'+posixpath.basename(part)+'.rels'
   if rel in names:
    for link in E.fromstring(z.read(rel)):
     if link.get('Type','').endswith('/notesSlide'):
      note=posixpath.normpath(posixpath.join(posixpath.dirname(part),link.get('Target')));body=E.fromstring(z.read(note));rows=[]
      for shape in body.findall('.//{'+P+'}sp'):
       ph=shape.find('{'+P+'}nvSpPr/{'+P+'}nvPr/{'+P+'}ph')
       if ph is not None and ph.get('type')=='body':rows.extend(''.join(t.text or ''for t in para.iter('{'+A+'}t'))for para in shape.findall('.//{'+A+'}p'))
      notes='\n'.join(rows)
   slides.append({'id':node.get('id'),'part':part,'hidden':xml.get('show','1') in ['0','false'],'notes':notes})
  return {'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'slides':slides,'parts':{n:hashlib.sha256(z.read(n)).hexdigest()for n in names}}
if sys.argv[1]=='inspect':print(json.dumps(inspect(Path(sys.argv[2])),ensure_ascii=False));sys.exit(0)
root=Path(sys.argv[1]).resolve();assert str(root).startswith('/private/tmp/willyou-pptx-shortcuts-slides-')
base=json.loads(subprocess.check_output(['python3','scripts/files/pptx-notes-fixtures.py',str(root)],text=True));rows=[]
for c in base['cases']:
 path=root/c['name'];mode=path.stat().st_mode&0o777;path.chmod(0o600)
 with zipfile.ZipFile(path)as z:parts=[(n,z.read(n))for n in z.infolist()]
 changed=[];updated=[]
 for item,content in parts:
  if item.filename=='ppt/slides/slide2.xml':
   match=re.search(rb'<p:sld(?=[ >])[^>]*>',content);assert match
   start=re.sub(rb'\s+show="[^"]*"',b'',match.group());start=start.replace(b'<p:sld',b'<p:sld show="0"',1);content=content[:match.start()]+start+content[match.end():];changed.append(item.filename)
  changed_part=(item,content)
  updated.append(changed_part)
 assert changed==['ppt/slides/slide2.xml']
 with zipfile.ZipFile(path,'w')as z:
  for item,content in updated:z.writestr(item,content)
 path.chmod(mode);info=inspect(path);assert [s['hidden']for s in info['slides']]==[False,True];rows.append({'name':c['name'],'theme':c['theme'],'mode':c['mode'],**info})
print(json.dumps({'project':str(root),'cases':rows,'boundary':'Only own curated PPTX copies; initial hidden-second-slide preparation,not an acceptance action.'},ensure_ascii=False))
