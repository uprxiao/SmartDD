from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as E
import hashlib,json,datetime
base=Path('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx');paths=[base,*sorted(Path('/private/tmp/willyou-office-ack-A-VEAbrC/project').glob('*.xlsx'))];ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};rows=[]
def fingerprint(p):
 s=p.stat();return{'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'device':s.st_dev,'inode':s.st_ino,'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns}
for p in paths:
 before=fingerprint(p)
 with ZipFile(p)as z:
  w=E.fromstring(z.read('xl/workbook.xml'));calc=w.find('x:calcPr',ns);attrs=calc.attrib if calc is not None else{};sheet=E.fromstring(z.read('xl/worksheets/sheet2.xml'));cells={c.attrib['r']:c for c in sheet.findall('.//x:sheetData/x:row/x:c',ns)};cache={name:(cells[name].find('x:v',ns).text if cells[name].find('x:v',ns)is not None else None)for name in ['B2','B3','D2','D3','B4','B11','B12']}
  if p!=base:
   assert {k:v for k,v in attrs.items()if k not in ['fullCalcOnLoad','forceFullCalc']}=={k:v for k,v in rows[0]['calcPr'].items()if k not in ['fullCalcOnLoad','forceFullCalc']}
   for name,value in {'B2':7,'B3':7,'D2':9,'D3':12,'B4':100,'B11':6,'B12':8}.items():assert float(cache[name])==value
 after=fingerprint(p);assert after==before;rows.append({'path':str(p),'before':before,'after':after,'calcPr':attrs,'formulaAndArrayCaches':cache})
assert len(rows)==3;out={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'layer':'Independent post-App raw XML audit. CalcId/mode/all non-derived calcPr attributes preserved; onlyfullCalcOnLoad/forceFullCalc allowed. Seven specific real native ordinary/shared/array cache values verified for each final source. All source identity/hash/times unchanged. Not new product formal/code test cases.','rows':rows};Path('/private/tmp/willyou-dev155-calculation-audit.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print({'sources':len(rows),'preservedCalculationMetadata':True,'correctFinalFormulaCaches':14,'sourceFingerprintsUnchanged':True})
