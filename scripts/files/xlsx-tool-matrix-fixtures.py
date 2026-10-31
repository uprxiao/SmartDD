"""W24 owned fixtures and independent source/format/part oracle (no app logic)."""
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
import copy,json,re,sys,xml.etree.ElementTree as E
X='http://schemas.openxmlformats.org/spreadsheetml/2006/main';ns={'x':X}
ACTIONS=['fill-down','fill-right','merge','unmerge','clear-contents','clear-format','clear-all','bold','italic','underline','strike','center','right','left','wrap','border','font-size','conditional','fit-column','fit-row','checkbox','invalid-size']
FIELDS=['font-family','number','currency','percent','general','decimals','validation']
SEED=Path('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx')
def digest(b):return sha256(b).hexdigest()
def truth(node):return node is not None and node.get('val','1')not in ['0','false','none']
def coord(s):
 m=re.fullmatch(r'([A-Z]+)([0-9]+)',s.replace('$',''));assert m
 col=0
 for char in m[1]:col=col*26+ord(char)-64
 return col,int(m[2])
def computed_cells(root):
 arrays=[]
 for formula in root.findall('.//x:f',ns):
  if formula.get('t')=='array':
   addresses=formula.attrib['ref'].split(':');arrays.append((coord(addresses[0]),coord(addresses[-1])))
 return {c.get('r')for c in root.findall('.//x:sheetData/x:row/x:c',ns)if c.find('x:f',ns)is not None or any(lo[0]<=coord(c.get('r'))[0]<=hi[0]and lo[1]<=coord(c.get('r'))[1]<=hi[1]for lo,hi in arrays)}
def snapshot(path):
 with ZipFile(path)as z:
  names=z.namelist();parts={n:digest(z.read(n))for n in names};styles=E.fromstring(z.read('xl/styles.xml'));tables={n:list(styles.find('x:'+n,ns)or[])for n in ['fonts','fills','borders','cellXfs','dxfs']};sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'));cells={};sources={}
  for name in names:
   if not re.fullmatch(r'xl/worksheets/sheet[0-9]+\.xml',name):continue
   root=E.fromstring(z.read(name));sources[name]={};computed=computed_cells(root)
   for c in root.findall('.//x:sheetData/x:row/x:c',ns):
    item=copy.deepcopy(c);formula=c.find('x:f',ns)
    if c.get('r')in computed:
     for v in item.findall('x:v',ns):item.remove(v)
     if item.get('t')=='n':item.attrib.pop('t')
    sources[name][c.attrib['r']]=digest(E.tostring(item))
    if name!='xl/worksheets/sheet1.xml':continue
    v=c.find('x:v',ns);kind=c.get('t');value=''.join(t.text or ''for t in c.findall('.//x:t',ns))if kind=='inlineStr'else(v.text or''if v is not None else'')
    if kind=='s':raise AssertionError('Corpus oracle intentionally does not generalize shared strings')
    xf=tables['cellXfs'][int(c.get('s','0'))];font=tables['fonts'][int(xf.get('fontId','0'))];align=xf.find('x:alignment',ns);fill=tables['fills'][int(xf.get('fillId','0'))];border=tables['borders'][int(xf.get('borderId','0'))]
    def val(tag):
     n=font.find('x:'+tag,ns);return n.get('val')if n is not None else None
    num_id=int(xf.get('numFmtId','0'));num_formats=styles.find('x:numFmts',ns);num_code=next((n.get('formatCode')for n in num_formats if int(n.get('numFmtId'))==num_id),None)if num_formats is not None else None
    cells[c.attrib['r']]={'value':value,'kind':kind,'style':int(c.get('s','0')),'numberFormat':{'id':num_id,'code':num_code},'font':{'family':val('name'),'points':val('sz'),'bold':truth(font.find('x:b',ns)),'italic':truth(font.find('x:i',ns)),'underline':truth(font.find('x:u',ns)),'strike':truth(font.find('x:strike',ns))},'align':dict(align.attrib)if align is not None else{},'border':all((n:=border.find('x:'+edge,ns))is not None and bool(n.get('style'))for edge in ['left','right','top','bottom']),'fill':E.tostring(fill).decode()}
  return {'path':str(path),'sha256':digest(Path(path).read_bytes()),'names':names,'parts':parts,'cells':cells,'sources':sources,'styles':{n:[digest(E.tostring(e))for e in entries]for n,entries in tables.items()},'merges':[x.get('ref')for x in sheet.findall('x:mergeCells/x:mergeCell',ns)],'rows':{r.get('r'):dict(r.attrib)for r in sheet.findall('x:sheetData/x:row',ns)},'columns':[dict(c.attrib)for c in sheet.findall('x:cols/x:col',ns)],'conditional':[{'sqref':c.get('sqref'),'formulas':[f.text for f in c.findall('.//x:formula',ns)]}for c in sheet.findall('x:conditionalFormatting',ns)],'controls':[n for n in names if n.startswith('xl/ctrlProps/')and n.endswith('.xml')]}
def create(root,actions=ACTIONS):
 assert str(root.resolve()).startswith('/private/tmp/willyou-xlsx-tool-matrix-A-');root.mkdir(exist_ok=True,parents=True);rows=[]
 with ZipFile(SEED)as z:
  for theme in ['light','dark']:
   for action in actions:
    path=root/(theme+'-'+action+'.xlsx');sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'));sheet.find('x:dimension',ns).set('ref','A1:H8');data=sheet.find('x:sheetData',ns);data.clear()
    for r in range(1,9):
     attrs={'r':str(r)}
     if r==2:attrs.update({'ht':'60','customHeight':'1'})
     row=E.SubElement(data,'{'+X+'}row',attrs)
     for c in range(1,9):
      if(r,c)==(8,8):continue
      address=chr(64+c)+str(r);a={'r':address}
      if address=='C2'or action=='general'and address=='C3':a['s']='1'
      cell=E.SubElement(row,'{'+X+'}c',a)
      text={'A1':'Label','B1':'Value','A2':'A','A3':'B','C4':'Width measurement: a deliberately long local cell'}.get(address)
      if text is not None:
       cell.set('t','inlineStr');i=E.SubElement(cell,'{'+X+'}is');E.SubElement(i,'{'+X+'}t').text=text
      else:E.SubElement(cell,'{'+X+'}v').text=str(3 if address=='B2'else 4 if address=='B3'else r*10+c)
    if action=='unmerge':
     merge=E.Element('{'+X+'}mergeCells',{'count':'1'});E.SubElement(merge,'{'+X+'}mergeCell',{'ref':'C2:D2'});sheet.insert(list(sheet).index(data)+1,merge)
    with ZipFile(path,'w')as out:
     for item in z.infolist():
      b=z.read(item)
      if item.filename=='xl/worksheets/sheet1.xml':b=E.tostring(sheet,encoding='utf-8')
      if item.filename=='xl/styles.xml':b=b.replace(b'<name val="Calibri"/>',b'<name val="Arial"/>')
      # zipfile.writestr mutates ZipInfo offsets; never mutate the reader's index.
      out.writestr(copy.copy(item),b)
    rows.append({'name':path.name,'theme':theme,'action':action,'before':snapshot(path)})
 return {'seed':str(SEED),'seedSha256':digest(SEED.read_bytes()),'root':str(root),'cases':rows,'boundary':'Owned rich OOXML copies;new finite8x8values,Arial Normal font,60pt row2 and explicit unmerge precondition. All original unrelated parts retained. Not created by product edit/save under test.'}
if __name__=='__main__':
 if sys.argv[1]=='create':print(json.dumps(create(Path(sys.argv[2])),ensure_ascii=False))
 elif sys.argv[1]=='create-fields':print(json.dumps(create(Path(sys.argv[2]),FIELDS),ensure_ascii=False))
 elif sys.argv[1]=='inspect':print(json.dumps(snapshot(Path(sys.argv[2])),ensure_ascii=False))
