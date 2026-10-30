"""Independent cache-only OOXML reader: never evaluates a formula."""
from pathlib import Path
import sys,json,zipfile,hashlib,xml.etree.ElementTree as E
path=Path(sys.argv[1]);S='{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
with zipfile.ZipFile(path)as z:
 names=z.namelist();parts={n:hashlib.sha256(z.read(n)).hexdigest()for n in names};cells={}
 for c in E.fromstring(z.read('xl/worksheets/sheet1.xml')).iter(S+'c'):
  f,v=c.find(S+'f'),c.find(S+'v');cells[c.attrib['r']]={'formula':f.text if f is not None else None,'type':c.attrib.get('t','n'),'cache':v.text if v is not None else None,'xml':E.tostring(c,encoding='unicode')}
 calc=E.fromstring(z.read('xl/workbook.xml')).find(S+'calcPr')
print(json.dumps({'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'names':names,'parts':parts,'cells':cells,'calcPr':calc.attrib if calc is not None else None,'reader':'Python stdlib zipfile/XML cache-only, no evaluation'},ensure_ascii=False))
