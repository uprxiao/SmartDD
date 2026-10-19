"""Independent read-only ZIP/XML oracle for owned PPTX retry fixtures."""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
import json,sys,xml.etree.ElementTree as E
p=Path(sys.argv[1]);ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main','c':'http://schemas.openxmlformats.org/drawingml/2006/chart'}
with ZipFile(p)as z:
 names=z.namelist();parts={name:sha256(z.read(name)).hexdigest()for name in names}
 notes={name:[x.text or ''for x in E.fromstring(z.read(name)).findall('.//a:t',ns)]for name in names if name.startswith('ppt/notesSlides/notesSlide')and name.endswith('.xml')}
 charts={name:[x.text or ''for x in E.fromstring(z.read(name)).findall('.//c:val/c:numRef/c:numCache/c:pt/c:v',ns)]for name in names if name.startswith('ppt/charts/chart')and name.endswith('.xml')}
print(json.dumps({'path':str(p),'sha256':sha256(p.read_bytes()).hexdigest(),'size':p.stat().st_size,'names':names,'parts':parts,'notes':notes,'charts':charts},ensure_ascii=False))
