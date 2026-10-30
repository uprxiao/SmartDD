"""Y12 own XLSX inputs; old caches deliberately differ from the edit result."""
from pathlib import Path
import tempfile,zipfile,json,hashlib
root=Path(tempfile.mkdtemp(prefix='willyou-formula-cache-',dir='/private/tmp'))/'project';root.mkdir()
S='http://schemas.openxmlformats.org/spreadsheetml/2006/main'
parts={
 '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/octet-stream"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
 '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
 'xl/workbook.xml':f'<workbook xmlns="{S}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="r1"/></sheets><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="0"/></workbook>',
 'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
 'custom/untouched.bin':'Y12_UNEDITED_PRIVATE_PART_中文🙂',
}
cases=[]
for theme in ['light','dark']:
 for mode in ['supported','unsupported']:
  p=dict(parts);formula='A1*2'if mode=='supported'else'WILLYOUNOTIMPLEMENTED(A1)';old=16 if mode=='supported' else 999
  p['xl/worksheets/sheet1.xml']=f'<worksheet xmlns="{S}"><dimension ref="A1:D3"/><sheetData><row r="1"><c r="A1"><v>8</v></c><c r="B1"><f>{formula}</f><v>{old}</v></c><c r="C1"><f>B1+3</f><v>{old+3}</v></c><c r="D1"><v>107</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>UNCHANGED 中文🙂</t></is></c><c r="D3"><v>0</v></c></row></sheetData></worksheet>'
  name=theme+'-'+mode+'.xlsx'
  with zipfile.ZipFile(root/name,'w',compression=zipfile.ZIP_DEFLATED)as z:
   for n,v in p.items():z.writestr(zipfile.ZipInfo(n,(2026,10,19,0,0,0)),v.encode())
  cases.append({'name':name,'theme':theme,'mode':mode,'input':8,'edit':21,'oldCaches':{'B1':old,'C1':old+3},'newCaches':{'B1':42,'C1':45}if mode=='supported'else{'B1':None,'C1':None},'sha256':hashlib.sha256((root/name).read_bytes()).hexdigest()})
manifest={'projectPath':str(root),'cases':cases,'boundary':'Original minimal valid XLSX with two dependent formulas, independent old numeric caches and three unrelated cells plus unknown binary part. Unsupported function is real native-engine negative control, not a substituted failure.'};(root.parent/'fixtures.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps(manifest,ensure_ascii=False))
