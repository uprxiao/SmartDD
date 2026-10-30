"""Independent finite W24 OOXML oracle; no product modules or mutation under test."""
from pathlib import Path
from zipfile import ZipFile
import copy,importlib.util,json,sys,xml.etree.ElementTree as E
spec=importlib.util.spec_from_file_location('fixtures',Path(__file__).with_name('xlsx-tool-matrix-fixtures.py'));f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
X=f.X;ns=f.ns
def xml(data):return E.fromstring(data)
def serial(node):return E.tostring(node)
def normalize_sheet(data,targets=(),action=''):
 root=xml(data);computed=f.computed_cells(root)
 for row in root.findall('x:sheetData/x:row',ns):
  if action=='fit-row'and row.get('r')=='2':
   for k in ['ht','customHeight']:row.attrib.pop(k,None)
  for c in list(row):
   if c.get('r')in targets:row.remove(c);continue
   if c.get('r')in computed:
    for v in c.findall('x:v',ns):c.remove(v)
    if c.get('t')=='n':c.attrib.pop('t')
 for name in (['cols']if action=='fit-column'else ['mergeCells']if action in ['merge','unmerge']else ['conditionalFormatting']if action=='conditional'else ['dataValidations']if action=='validation'else ['controls','legacyDrawing']if action=='checkbox'else []):
  for node in root.findall('x:'+name,ns):root.remove(node)
 if action=='checkbox':
  for node in root.findall('{http://schemas.openxmlformats.org/markup-compatibility/2006}AlternateContent'):
   if node.find('.//x:controls',ns)is not None:root.remove(node)
 return serial(root)
def check(before_path,after_path,action,toggled=False):
 b=f.snapshot(before_path);a=f.snapshot(after_path)
 target='B3'if action=='fill-down'else'D2'if action=='fill-right'else'H8'if action=='checkbox'else'C2'if action in ['clear-contents','clear-format','clear-all','merge','unmerge','fit-row','fit-column']else'C3'
 targets=[]if action in ['merge','unmerge','fit-row','fit-column']else[target]
 if action=='invalid-size':assert a['sha256']==b['sha256'];return {'sourceUnchanged':True}
 assert a['sha256']!=b['sha256'],'No real persisted operation'
 if action!='checkbox':assert a['names']==b['names'],'ZIP names/order changed'
 else:assert [n for n in a['names']if n in b['names']]==b['names']
 allowed={'xl/worksheets/sheet1.xml','xl/workbook.xml','xl/styles.xml'}
 if action=='checkbox':allowed.update({'[Content_Types].xml','xl/worksheets/_rels/sheet1.xml.rels','xl/drawings/drawing1.xml'})
 with ZipFile(before_path)as bz,ZipFile(after_path)as az:
  for n in b['names']:
   if n in allowed:continue
   if n.startswith('xl/worksheets/')and n.endswith('.xml'):
    assert normalize_sheet(bz.read(n))==normalize_sheet(az.read(n)),('Non-target sheet source',n)
   else:assert b['parts'][n]==a['parts'][n],('Unrelated ZIP part',n)
  bw=xml(bz.read('xl/workbook.xml'));aw=xml(az.read('xl/workbook.xml'))
  for root in [bw,aw]:
   for n in root.findall('x:calcPr',ns):root.remove(n)
  assert serial(bw)==serial(aw),'Workbook metadata except calculation cache changed'
  assert normalize_sheet(bz.read('xl/worksheets/sheet1.xml'),targets,action)==normalize_sheet(az.read('xl/worksheets/sheet1.xml'),targets,action),'Non-target worksheet structure/source changed'
  bs=xml(bz.read('xl/styles.xml'));ass=xml(az.read('xl/styles.xml'))
  for name in ['fonts','fills','borders','cellXfs','dxfs','numFmts']:
   old=bs.find('x:'+name,ns);new=ass.find('x:'+name,ns)
   oldlist=list(old)if old is not None else[];newlist=list(new)if new is not None else[]
   assert len(newlist)>=len(oldlist),(name,'lost old entries')
   assert [serial(e)for e in oldlist]==[serial(e)for e in newlist[:len(oldlist)]],(name,'modified existing entries')
   if old is not None:bs.remove(old)
   if new is not None:ass.remove(new)
  assert serial(bs)==serial(ass),'Other style metadata changed'
  # Existing relationships/overrides must survive checkbox part insertion unchanged.
  if action=='checkbox':
   for n in ['[Content_Types].xml','xl/worksheets/_rels/sheet1.xml.rels']:
    old=xml(bz.read(n));new=xml(az.read(n));olditems=[serial(x)for x in old];assert all(x in [serial(y)for y in new]for x in olditems),(n,'lost original relation')
   assert set(a['names'])-set(b['names'])=={'xl/ctrlProps/ctrlProp1.xml','xl/drawings/vmlDrawing1.vml'}
   assert a['controls']==['xl/ctrlProps/ctrlProp1.xml'];control=xml(az.read(a['controls'][0]));assert control.get('objectType')=='CheckBox'and control.get('fmlaLink')=="'Data'!$H$8";assert control.get('checked','Unchecked')==('Checked'if toggled else'Unchecked')
   vml=xml(az.read('xl/drawings/vmlDrawing1.vml'));ex={'e':'urn:schemas-microsoft-com:office:excel'};client=vml.findall('.//e:ClientData',ex);assert len(client)==1 and client[0].get('ObjectType')=='Checkbox';assert client[0].find('e:FmlaLink',ex).text=='$H$8';checked=client[0].find('e:Checked',ex);assert(checked.text if checked is not None else'0')==('1'if toggled else'0')
   oldraw=bz.read('xl/drawings/drawing1.xml');newraw=az.read('xl/drawings/drawing1.xml');tail=oldraw[oldraw.rfind(b'</'):];assert newraw.startswith(oldraw[:-len(tail)])and newraw.endswith(tail),'Original drawing bytes changed'
   old=xml(oldraw);new=xml(newraw);assert[serial(n)for n in list(new)[:len(old)]]==[serial(n)for n in old];assert len(new)==len(old)+1
   dn={'d':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'};anchor=new[-1].find('.//d:twoCellAnchor',dn);assert anchor is not None;assert anchor.find('d:from/d:col',dn).text==anchor.find('d:from/d:row',dn).text=='7';shape=anchor.find('d:sp/d:nvSpPr/d:cNvPr',dn);assert shape.get('name')=='WillYou_Checkbox_'+shape.get('id');sheet=xml(az.read('xl/worksheets/sheet1.xml'));controls=sheet.findall('.//x:controls/x:control',ns);assert len(controls)==1 and controls[0].get('shapeId')==shape.get('id')
   relation_id=controls[0].get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id');relations=xml(az.read('xl/worksheets/_rels/sheet1.xml.rels'));relation=next(n for n in relations if n.get('Id')==relation_id);assert relation.get('Type').endswith('/ctrlProp')and relation.get('Target').endswith('/ctrlProp1.xml')
 for sheet,values in b['sources'].items():
  for addr,h in values.items():
   if sheet=='xl/worksheets/sheet1.xml'and addr in targets:continue
   assert a['sources'][sheet].get(addr)==h,(sheet,addr,'source changed')
 bc=b['cells'].get(target);ac=a['cells'].get(target)
 if action=='fill-down':assert ac['value']=='3'and ac['style']==bc['style']
 elif action=='fill-right':assert ac['value']==b['cells']['C2']['value']and ac['style']==bc['style']
 elif action=='merge':assert a['merges']==['C2:D2']
 elif action=='unmerge':assert not a['merges']
 elif action=='clear-contents':assert ac['value']==''and ac['style']==bc['style']
 elif action=='clear-format':assert ac['value']==bc['value']and ac['style']==0
 elif action=='clear-all':assert(not ac or ac['value']=='')and(not ac or ac['style']==0)
 elif action in ['bold','italic','underline','strike']:assert ac['font'][action]is True and ac['value']==bc['value']
 elif action in ['left','center','right']:assert ac['align']['horizontal']==action and ac['value']==bc['value']
 elif action=='wrap':assert ac['align']['wrapText']=='1'and ac['value']==bc['value']
 elif action=='border':assert ac['border']and ac['value']==bc['value']
 elif action=='font-size':assert float(ac['font']['points'])==15 and ac['value']==bc['value']
 elif action=='font-family':assert ac['font']['family']=='Georgia'and ac['value']==bc['value']
 elif action in ['number','currency','percent','general','decimals']:
  expected={'number':'#,##0.00','currency':'"¥"#,##0.00','percent':'0.00%','decimals':'0.000'}
  assert ac['value']==bc['value']and ac['kind']==bc['kind']
  if action=='general':assert ac['numberFormat']['id']==0
  else:assert ac['numberFormat']['code']==expected[action],ac['numberFormat']
 elif action=='validation':
  with ZipFile(after_path)as z:
   rule=xml(z.read('xl/worksheets/sheet1.xml')).find('x:dataValidations/x:dataValidation',ns);assert rule is not None and rule.get('sqref')=='C3:C3';assert rule.get('type')=='custom'and rule.find('x:formula1',ns).text=='OR(ISNUMBER(C3),ISFORMULA(C3),C3="")'
  assert ac['value']==bc['value']and ac['style']==bc['style']
 elif action=='conditional':
  assert a['conditional']==[{'sqref':'C3:C3','formulas':['AND(ISNUMBER(C3),C3>20)']}]and ac['value']==bc['value']and ac['style']==bc['style']
  with ZipFile(after_path)as z:
   sheet=xml(z.read('xl/worksheets/sheet1.xml'));rule=sheet.find('x:conditionalFormatting/x:cfRule',ns);assert rule.get('type')=='expression';styles=xml(z.read('xl/styles.xml'));dxf=list(styles.find('x:dxfs',ns))[int(rule.get('dxfId'))];assert dxf.find('x:fill/x:patternFill/x:fgColor',ns).get('rgb')=='FFFFF0C8'
 elif action=='fit-column':assert any(int(c['min'])<=3<=int(c['max'])and float(c['width'])>20 for c in a['columns'])
 elif action=='fit-row':assert 0<float(a['rows']['2']['ht'])<60
 elif action=='checkbox':assert ac['kind']=='b'and ac['value']==('1'if toggled else'0')
 else:raise AssertionError(action)
 return {'action':action,'before':b['sha256'],'after':a['sha256'],'target':target,'targetValue':ac['value']if ac else None,'zipAndNonTargetPreserved':True,'originalStylesPreserved':True}
def main(run):
 run=Path(run);result=json.loads((run/'result.json').read_text());assert result['status'].startswith('UI save/reopen passed')
 before=json.loads((run/'fixtures.json').read_text());actions=list(dict.fromkeys(c['action']for c in before['cases']));original=f.create(run/'originals',actions);originals={c['name']:c for c in original['cases']};assert[(c['name'],c['before']['sha256'])for c in before['cases']]==[(c['name'],c['before']['sha256'])for c in original['cases']],'Recreated fixture differs'
 rows=[];failures=[]
 for c in result['checks']:
  name=c['theme']+'-'+c['action']+'.xlsx';path=run/(''+c['theme']+'-'+c['action']+'-saved.xlsx')if c['action']!='invalid-size'else run/'project'/name
  try:
   rows.append({'theme':c['theme'],**check(run/'originals'/name,path,c['action'])})
   if c['action']=='checkbox':rows.append({'theme':c['theme'],'toggled':True,**check(run/'originals'/name,run/(c['theme']+'-checkbox-toggled.xlsx'),'checkbox',True)})
  except Exception as error:failures.append({'theme':c['theme'],'action':c['action'],'error':repr(error)})
 out={'at':result['finishedAt'],'status':'failed'if failures else'passed','layer':'independent ZIP/XML action oracle','rows':rows,'failures':failures,'boundary':'Finite declared corpus;scalar/shared/declared-array formula caches and calcPr may normalize. Fill copies typed content while retaining target format,as required by existing range integration. Unrelated ZIP payloads,non-target cell sources and worksheet metadata,old style entries and original relations remain strict. No product modules.'};(run/'oracle.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':out['status'],'checks':len(rows),'failures':failures,'run':str(run)}));assert not failures
if __name__=='__main__':main(sys.argv[1])
