#!/usr/bin/env python3
"""Synthetic legacy OOXML form checkbox format round-trip via isolated UNO."""
import uno,subprocess,tempfile,pathlib,time,uuid,json,argparse,hashlib,zipfile

def named(n,v):
 p=uno.createUnoStruct('com.sun.star.beans.NamedValue');p.Name=n;p.Value=v;return p

def prop(n,v):
 p=uno.createUnoStruct('com.sun.star.beans.PropertyValue');p.Name=n;p.Value=v;return p
p=argparse.ArgumentParser();p.add_argument('--out',required=True);a=p.parse_args();out=pathlib.Path(a.out).resolve();out.mkdir(exist_ok=True);report={'scope':'generated legacy checkbox capability proof','scriptSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
with tempfile.TemporaryDirectory(prefix='predev-office-checkbox-') as td:
 root=pathlib.Path(td);pipe='m9_'+uuid.uuid4().hex
 proc=subprocess.Popen(['/Applications/LibreOffice.app/Contents/MacOS/soffice','-env:UserInstallation='+(root/'profile').as_uri(),'--headless','--norestore','--nodefault',f'--accept=pipe,name={pipe};urp;StarOffice.ComponentContext'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 desktop=None;doc=None
 try:
  local=uno.getComponentContext();resolver=local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver',local);ctx=None
  for i in range(100):
   try:ctx=resolver.resolve(f'uno:pipe,name={pipe};urp;StarOffice.ComponentContext');break
   except Exception:time.sleep(.1)
  if ctx is None:raise RuntimeError('UNO timeout')
  desktop=ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop',ctx);options=(prop('Hidden',True),prop('MacroExecutionMode',4),prop('UpdateDocMode',0))
  doc=desktop.loadComponentFromURL('private:factory/scalc','_blank',0,options);sh=doc.Sheets.getByIndex(0);sh.Name='Checkbox';sh.getCellRangeByName('A1').String='CHECKBOX_FIXTURE'
  page=sh.DrawPage;form=doc.createInstance('com.sun.star.form.component.Form');page.Forms.insertByName('M9Form',form)
  model=doc.createInstance('com.sun.star.form.component.CheckBox');model.Name='M9_Checkbox';model.Label='M9 checkbox';model.TriState=False;form.insertByName('M9_Checkbox',model)
  binding=doc.createInstanceWithArguments('com.sun.star.table.CellValueBinding',(named('BoundCell',sh.getCellRangeByName('B2').CellAddress),));model.setValueBinding(binding)
  shape=doc.createInstance('com.sun.star.drawing.ControlShape');pos=uno.createUnoStruct('com.sun.star.awt.Point');pos.X=500;pos.Y=1000;size=uno.createUnoStruct('com.sun.star.awt.Size');size.Width=3000;size.Height=700;shape.Position=pos;shape.Size=size;shape.Control=model;page.add(shape)
  model.State=1;report['before']={'state':model.State,'boundCellValue':sh.getCellRangeByName('B2').Value}
  path=out/'checkbox.xlsx';doc.storeAsURL(path.as_uri(),(prop('FilterName','Calc MS Excel 2007 XML'),));doc.close(True);doc=None
  doc=desktop.loadComponentFromURL(path.as_uri(),'_blank',0,options);sh=doc.Sheets.getByIndex(0);controls=[]
  for i in range(sh.DrawPage.Count):
   obj=sh.DrawPage.getByIndex(i)
   if obj.supportsService('com.sun.star.drawing.ControlShape'):
    m=obj.Control;binding=m.getValueBinding();controls.append({'name':m.Name,'state':m.State,'label':m.Label,'bound':str(binding.BoundCell) if binding else None})
  report['reopen']={'controls':controls,'cell':sh.getCellRangeByName('B2').Value}
  assert len(controls)==1 and controls[0]['state']==1 and controls[0]['bound'] and sh.getCellRangeByName('B2').Value==1
  obj.Control.State=0;report['toggle']={'state':obj.Control.State,'cell':sh.getCellRangeByName('B2').Value};assert report['toggle']['cell']==0
  target=out/'checkbox-unchecked.xlsx';doc.storeAsURL(target.as_uri(),(prop('FilterName','Calc MS Excel 2007 XML'),));doc.close(True);doc=None
  # Exact original-package toggle: no whole-engine rewrite or anchor drift.
  with zipfile.ZipFile(path) as z:original={n:z.read(n) for n in z.namelist()}
  candidate=dict(original)
  n='xl/ctrlProps/ctrlProps2.xml';assert candidate[n].count(b' checked="Checked"')==1;candidate[n]=candidate[n].replace(b' checked="Checked"',b'')
  n='xl/drawings/vmlDrawing1.vml';assert candidate[n].count(b'<x:Checked>1</x:Checked>')==1;candidate[n]=candidate[n].replace(b'<x:Checked>1</x:Checked>',b'')
  n='xl/worksheets/sheet1.xml';assert candidate[n].count(b'<c r="B2" s="2" t="b"><v>1</v></c>')==1;candidate[n]=candidate[n].replace(b'<c r="B2" s="2" t="b"><v>1</v></c>',b'<c r="B2" s="2" t="b"><v>0</v></c>')
  precise=out/'checkbox-precise-unchecked.xlsx'
  with zipfile.ZipFile(precise,'w',zipfile.ZIP_DEFLATED) as z:
   for n,b in candidate.items():z.writestr(n,b)
  changed=[n for n in original if original[n]!=candidate[n]];assert len(changed)==3
  doc=desktop.loadComponentFromURL(precise.as_uri(),'_blank',0,options);sh=doc.Sheets.getByIndex(0);m=next(sh.DrawPage.getByIndex(i).Control for i in range(sh.DrawPage.Count) if sh.DrawPage.getByIndex(i).supportsService('com.sun.star.drawing.ControlShape'))
  assert m.State==0 and sh.getCellRangeByName('B2').Value==0 and m.getValueBinding()
  report['preciseToggle']={'state':m.State,'cell':sh.getCellRangeByName('B2').Value,'changedParts':changed,'retainedPartHashes':{n:hashlib.sha256(b).hexdigest() for n,b in original.items() if candidate[n]==b}}
  doc.close(True);doc=None
  with zipfile.ZipFile(path) as z:report['formatParts']={n:z.read(n).decode('utf8','replace') for n in z.namelist() if any(x in n for x in ['ctrlProps','vmlDrawing','controls','worksheets/sheet1.xml','worksheets/_rels/sheet1.xml.rels'])}
  report['status']='passed'
 except Exception as e:report['status']='failed';report['error']=repr(e)
 finally:
  if doc:doc.close(True)
  if desktop:desktop.terminate()
  try:proc.wait(5)
  except subprocess.TimeoutExpired:proc.kill();proc.wait()
report['processExit']=proc.returncode;(out/'checkbox-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='formatParts'},ensure_ascii=False));raise SystemExit(report['status']!='passed')
