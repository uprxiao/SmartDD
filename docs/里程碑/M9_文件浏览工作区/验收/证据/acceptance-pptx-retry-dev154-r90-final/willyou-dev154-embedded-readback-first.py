from pathlib import Path
from zipfile import ZipFile
from io import BytesIO
import xml.etree.ElementTree as E
import hashlib,json,re,posixpath,datetime
ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main','c':'http://schemas.openxmlformats.org/drawingml/2006/chart','x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};rid='{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
base=Path('/private/tmp/willyou-office-retry-A-AQwT4N/project');paths=[Path('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.pptx'),*sorted(base.glob('*.pptx'))];rows=[]
def mark(path):
 s=path.stat();return{'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'device':s.st_dev,'inode':s.st_ino,'size':s.st_size,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns}
def relation(z,part,key):
 folder=posixpath.dirname(part);rels={r.attrib['Id']:r.attrib for r in E.fromstring(z.read(folder+'/_rels/'+posixpath.basename(part)+'.rels'))};r=rels[key];assert r.get('TargetMode')!='External';return posixpath.normpath(folder+'/'+r['Target'])
for path in paths:
 before=mark(path);charts=[]
 with ZipFile(path)as z:
  for slide in z.namelist():
   if not(slide.startswith('ppt/slides/slide')and slide.endswith('.xml')):continue
   for node in E.fromstring(z.read(slide)).findall('.//c:chart',ns):
    chart=relation(z,slide,node.attrib[rid]);xml=E.fromstring(z.read(chart));source=relation(z,chart,xml.find('c:externalData',ns).attrib[rid]);formula=xml.find('.//c:val/c:numRef/c:f',ns).text;match=re.fullmatch(r'([^!]+)!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)',formula);assert match and match[2]==match[4]
    addresses=[match[2]+str(i)for i in range(int(match[3]),int(match[5])+1)];cache=[n.text for n in xml.findall('.//c:val/c:numRef/c:numCache/c:pt/c:v',ns)]
    with ZipFile(BytesIO(z.read(source)))as w:
     workbook='xl/workbook.xml';sheet=next(n for n in E.fromstring(w.read(workbook)).findall('x:sheets/x:sheet',ns)if n.attrib['name']==match[1].strip("'"));part=relation(w,workbook,sheet.attrib[rid]);cells={n.attrib['r']:n.find('x:v',ns).text for n in E.fromstring(w.read(part)).findall('.//x:sheetData/x:row/x:c',ns)if n.find('x:v',ns)is not None};values=[cells[a]for a in addresses]
    assert [float(v)for v in values]==[float(v)for v in cache];expected=[15,27]if'-flush.pptx'in path.name else[3,4];assert [float(v)for v in values]==expected;charts.append({'slide':slide,'activeChart':chart,'embeddedSource':source,'formula':formula,'addresses':addresses,'cache':cache,'embeddedValues':values})
 assert len(charts)==1;after=mark(path);assert after==before;rows.append({'path':str(path),'before':before,'after':after,'charts':charts})
assert len(rows)==5;out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'layer':'Independent read-only ZIP/XML reader after actual App4 pass; follows current slide->chart->externalData->workbook->named worksheet and compares actual cached numeric range to embedded values. Does not open external apps, run macros or modify original/owned sources. This fixed-synthetic-reference reader is not a generic Office evaluator.','rows':rows};Path('/private/tmp/willyou-dev154-embedded-readback.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print({'readers':len(rows),'allActiveCachesMatchEmbeddedWorkbook':True,'allSourceIdentityAndTimesUnchanged':True})
