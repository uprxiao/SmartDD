"""Independent, read-only W25 preservation oracle; A1 value may be cleared/retyped.
The target's style/unknown metadata, all other source values/formulas and every
unrelated ZIP member remain strict. Only actual formula caches/calcPr normalize.
"""
from pathlib import Path
from hashlib import sha256
from zipfile import ZipFile
import json,re,sys,xml.etree.ElementTree as E
X='http://schemas.openxmlformats.org/spreadsheetml/2006/main';ns={'x':X}
def coord(s):
 m=re.fullmatch(r'([A-Z]+)([0-9]+)',s.replace('$',''));assert m
 c=0
 for a in m[1]:c=c*26+ord(a)-64
 return c,int(m[2])
def inspect(path):
 with ZipFile(path) as z:
  names=z.namelist();parts={n:sha256(z.read(n)).hexdigest()for n in names};normalized={};text=None;style=None
  for n in names:
   if not re.fullmatch(r'xl/worksheets/sheet[0-9]+\.xml',n):continue
   root=E.fromstring(z.read(n));arrays=[]
   for f in root.findall('.//x:f',ns):
    if f.get('t')=='array':
     a=f.attrib['ref'].split(':');arrays.append((coord(a[0]),coord(a[-1])))
   for c in root.findall('.//x:sheetData/x:row/x:c',ns):
    address=coord(c.attrib['r']);computed=c.find('x:f',ns)is not None or any(a[0]<=address[0]<=b[0]and a[1]<=address[1]<=b[1]for a,b in arrays)
    if computed:
     for v in c.findall('x:v',ns):c.remove(v)
     if c.get('t')=='n':c.attrib.pop('t')
    if n=='xl/worksheets/sheet1.xml'and c.attrib['r']=='A1':
     kind=c.get('t');v=c.find('x:v',ns)
     if kind=='inlineStr':text=''.join(t.text or ''for t in c.findall('.//x:t',ns))
     elif kind=='s':
      strings=E.fromstring(z.read('xl/sharedStrings.xml')).findall('x:si',ns);text=''.join(t.text or ''for t in strings[int(v.text)].iter('{'+X+'}t'))
     else:text=v.text if v is not None else''
     style=c.get('s','0')
     for child in list(c):
      if child.tag in ['{'+X+'}is','{'+X+'}v','{'+X+'}f']:c.remove(child)
     c.attrib.pop('t',None)
   normalized[n]=sha256(E.tostring(root)).hexdigest()
  root=E.fromstring(z.read('xl/workbook.xml'))
  for c in root.findall('x:calcPr',ns):root.remove(c)
  normalized['xl/workbook.xml']=sha256(E.tostring(root)).hexdigest()
  return {'sha256':sha256(Path(path).read_bytes()).hexdigest(),'names':names,'parts':parts,'normalized':normalized,'text':text,'style':style}
before,after=map(inspect,sys.argv[1:3]);assert before['names']==after['names'],'ZIP entry identities/order changed'
for n in before['names']:
 if n in before['normalized']:assert before['normalized'][n]==after['normalized'][n],f'Unrelated worksheet/workbook content changed: {n}'
 else:assert before['parts'][n]==after['parts'][n],f'Unrelated ZIP part changed: {n}'
assert before['style']==after['style'],'A1 style changed'
print(json.dumps({'before':before['sha256'],'after':after['sha256'],'text':after['text'],'style':after['style'],'zipNamesAndOrder':True,'nonTargetContentPreserved':True,'parts':len(after['names'])},ensure_ascii=False))
