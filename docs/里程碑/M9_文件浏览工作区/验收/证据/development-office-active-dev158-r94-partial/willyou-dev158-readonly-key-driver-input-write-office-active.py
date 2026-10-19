"""Independent same-inode, fsync test writer for the exact active OOXML target."""
from pathlib import Path
import hashlib,io,json,os,runpy,sys,zipfile,xml.etree.ElementTree as ET
path=Path(sys.argv[1]).resolve();host=sys.argv[2];text=sys.argv[3];assert str(path).startswith('/private/tmp/willyou-office-active-')
if path.suffix=='.xlsx':
 sys.argv=[sys.argv[0],str(path),text];runpy.run_path(str(Path(__file__).with_name('write-office-external.py')));sys.exit(0)
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'};original=path.read_bytes();before=path.stat()
with zipfile.ZipFile(io.BytesIO(original))as source:
 name='ppt/notesSlides/notesSlide1.xml'if host=='notes'else'ppt/slides/slide1.xml';root=ET.fromstring(source.read(name));shapes=root.findall('.//p:sp',ns)
 if host=='notes':shape=next(s for s in shapes if(s.find('p:nvSpPr/p:nvPr/p:ph',ns)is not None and s.find('p:nvSpPr/p:nvPr/p:ph',ns).get('type')=='body'))
 else:shape=next(s for s in shapes if s.find('p:txBody',ns)is not None)
 values=shape.findall('.//a:t',ns);assert values;values[0].text=text
 for node in values[1:]:node.text=''
 content=io.BytesIO()
 with zipfile.ZipFile(content,'w')as target:
  for info in source.infolist():target.writestr(info,ET.tostring(root,encoding='utf-8',xml_declaration=True)if info.filename==name else source.read(info))
data=content.getvalue()
with path.open('r+b')as stream:stream.write(data);stream.truncate();stream.flush();os.fsync(stream.fileno())
after=path.stat();assert(before.st_dev,before.st_ino)==(after.st_dev,after.st_ino);sha=lambda b:hashlib.sha256(b).hexdigest();print(json.dumps({'path':str(path),'host':host,'text':text,'changedPart':name,'beforeSha256':sha(original),'afterSha256':sha(data),'device':after.st_dev,'inode':after.st_ino,'sameInode':True,'otherPartsPreserved':True}))
