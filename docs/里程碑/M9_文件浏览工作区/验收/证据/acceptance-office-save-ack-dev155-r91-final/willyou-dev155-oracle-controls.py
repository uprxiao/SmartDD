from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as E
import tempfile,subprocess,json,hashlib,datetime
repo=Path.cwd();source=repo/'docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx';oracle=repo/'scripts/files/verify-office-ack.py';work=Path(tempfile.mkdtemp(prefix='willyou-dev155-oracle-',dir='/private/tmp'));ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
read=lambda p:json.loads(subprocess.check_output(['/usr/bin/python3',str(oracle),str(p)],text=True));before=read(source);rows=[]
for scenario in ['formula','style','unrelated-value','defined-name']:
 part='xl/workbook.xml'if scenario=='defined-name'else'xl/worksheets/sheet2.xml'if scenario in['formula','style']else'xl/worksheets/sheet1.xml'
 with ZipFile(source)as z:
  root=E.fromstring(z.read(part))
  if scenario=='formula':root.find('.//x:c[@r="B2"]/x:f',ns).text='Data!B2*999'
  elif scenario=='style':root.find('.//x:c[@r="E2"]',ns).set('s','2')
  elif scenario=='unrelated-value':root.find('.//x:c[@r="B2"]/x:v',ns).text='123456'
  else:root.find('x:definedNames/x:definedName',ns).text='Data!$B$3:$B$4'
  target=work/(scenario+'.xlsx')
  with ZipFile(target,'w')as out:
   for info in z.infolist():out.writestr(info,E.tostring(root,encoding='utf-8',xml_declaration=True)if info.filename==part else z.read(info.filename))
 after=read(target);different=after['workbookStructureHash']!=before['workbookStructureHash']if scenario=='defined-name'else after['worksheetStructureHashes'][part]!=before['worksheetStructureHashes'][part];assert different,scenario;rows.append({'scenario':scenario,'part':part,'source':str(target),'originalSha256':before['sha256'],'modifiedSha256':after['sha256'],'structureChangeDetected':True})
valid=read(Path('/private/tmp/willyou-office-ack-A-zDkUji/project/light.xlsx'));assert valid['worksheetStructureHashes']==before['worksheetStructureHashes']and valid['workbookStructureHash']==before['workbookStructureHash'];assert read(source)['sha256']==before['sha256'];result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'boundary':'Independent reader discrimination controls only, owned synthetic ZIP/XML mutations; not product U/I/A or new formal cases. Accepts actual first-save target edit/recalculation but rejects source formula, cell style, unrelated constant and defined-name changes. Original reference source unchanged.','legitimateTargetAndCacheChangesAccepted':True,'rows':rows};Path('/private/tmp/willyou-dev155-oracle-controls.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print({'controls':len(rows),'allForbiddenSourceChangesDetected':True,'legitimateCalculationChangesAccepted':True})
