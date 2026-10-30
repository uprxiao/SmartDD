"""Read-only independent OOXML source/format oracle for owned W27 fixtures."""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
import sys,json,xml.etree.ElementTree as E,copy
p=Path(sys.argv[1]);ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
with ZipFile(p)as z:
 names=z.namelist();parts={name:sha256(z.read(name)).hexdigest()for name in names};out={'path':str(p),'sha256':sha256(p.read_bytes()).hexdigest(),'names':names,'parts':parts}
 if p.suffix=='.xlsx':
  root=E.fromstring(z.read('xl/worksheets/sheet1.xml'));cell=next(c for c in root.findall('.//x:sheetData/x:row/x:c',ns)if c.attrib['r']=='A1');kind=cell.attrib.get('t');value=cell.find('x:v',ns)
  if kind=='s':strings=E.fromstring(z.read('xl/sharedStrings.xml')).findall('x:si',ns);text=''.join(t.text or ''for t in strings[int(value.text)].iter('{'+ns['x']+'}t'))
  elif kind=='inlineStr':text=''.join(t.text or ''for t in cell.findall('.//x:t',ns))
  else:text=value.text if value is not None else''
  out.update({'text':text,'target':'A1','style':cell.attrib.get('s'),'sheetStructure':{'dimension':root.find('x:dimension',ns).attrib if root.find('x:dimension',ns)is not None else{},'merges':[n.attrib for n in root.findall('x:mergeCells/x:mergeCell',ns)],'columns':[n.attrib for n in root.findall('x:cols/x:col',ns)]}})
 else:
  root=E.fromstring(z.read('ppt/slides/slide1.xml'));shapes=list(root.find('p:cSld/p:spTree',ns));target=next(n for n in shapes if n.tag=='{'+ns['p']+'}sp'and n.find('p:txBody',ns)is not None);ident=target.find('.//p:cNvPr',ns).attrib;shape=copy.deepcopy(target)
  for node in shape.findall('.//a:t',ns):node.text=''
  out.update({'text':'\n'.join(''.join(t.text or ''for t in para.findall('.//a:t',ns))for para in target.findall('.//a:p',ns)),'target':ident,'targetFormatHash':sha256(E.tostring(shape)).hexdigest(),'otherObjects':{n.find('.//p:cNvPr',ns).attrib['id']:sha256(E.tostring(n)).hexdigest()for n in shapes if n is not target and n.find('.//p:cNvPr',ns)is not None}})
print(json.dumps(out,ensure_ascii=False))
