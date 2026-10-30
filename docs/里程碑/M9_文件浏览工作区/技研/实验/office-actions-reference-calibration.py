#!/usr/bin/env python3
"""Independent LibreOffice-generated deletion reference syntax, synthetic workbook only."""
import argparse, hashlib, json, pathlib, subprocess, tempfile, time, uuid, zipfile
import xml.etree.ElementTree as ET
import uno

def prop(name,value):
    p=uno.createUnoStruct('com.sun.star.beans.PropertyValue');p.Name=name;p.Value=value;return p

ap=argparse.ArgumentParser();ap.add_argument('--output',required=True);args=ap.parse_args()
report={'scope':'Synthetic LibreOffice-generated invalid sheet reference calibration; no user files','scriptSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
with tempfile.TemporaryDirectory(prefix='m9-ref-calibration-') as temp:
    root=pathlib.Path(temp);pipe='m9_'+uuid.uuid4().hex;desktop=None;doc=None
    with (root/'engine.log').open('wb') as log:
        proc=subprocess.Popen(['/Applications/LibreOffice.app/Contents/MacOS/soffice','-env:UserInstallation='+(root/'profile').as_uri(),'--headless','--norestore','--nodefault',f'--accept=pipe,name={pipe};urp;StarOffice.ComponentContext'],stdout=log,stderr=log)
        try:
            local=uno.getComponentContext();resolver=local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver',local)
            context=None
            for _ in range(100):
                try:context=resolver.resolve(f'uno:pipe,name={pipe};urp;StarOffice.ComponentContext');break
                except Exception:time.sleep(.1)
            if context is None:raise RuntimeError('UNO timeout')
            desktop=context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop',context)
            doc=desktop.loadComponentFromURL('private:factory/scalc','_blank',0,(prop('Hidden',True),prop('MacroExecutionMode',0),prop('UpdateDocMode',0)))
            data=doc.Sheets.getByIndex(0);data.Name='Data';data.getCellRangeByName('B2').Value=3;data.getCellRangeByName('B3').Value=4
            doc.Sheets.insertNewByName('Calc',1);calc=doc.Sheets.getByName('Calc');calc.getCellRangeByName('B2').Formula='=Data.B2+Data.B3';calc.getCellRangeByName('B3').Formula='=SUM(Data.B2:B3)'
            doc.calculateAll();report['beforeValues']=[calc.getCellRangeByName(c).Value for c in ['B2','B3']]
            doc.Sheets.removeByName('Data');doc.calculateAll();report['afterEngineFormula']=[calc.getCellRangeByName(c).Formula for c in ['B2','B3']];report['afterEngineErrors']=[calc.getCellRangeByName(c).Error for c in ['B2','B3']]
            out=root/'deleted.xlsx';doc.storeAsURL(out.as_uri(),(prop('FilterName','Calc MS Excel 2007 XML'),));doc.close(True);doc=None
            with zipfile.ZipFile(out) as z:
                ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                report['serializedCells']=[{'cell':c.get('r'),'formula':c.findtext('s:f',namespaces=ns),'value':c.findtext('s:v',namespaces=ns),'type':c.get('t')} for c in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:c',ns)]
                report['serializedWorksheetXml']=z.read('xl/worksheets/sheet1.xml').decode()
            doc=desktop.loadComponentFromURL(out.as_uri(),'_blank',0,(prop('Hidden',True),prop('MacroExecutionMode',0),prop('UpdateDocMode',0)))
            calc=doc.Sheets.getByName('Calc')
            report['selfReopenBeforeCalculate']=[{'formula':calc.getCellRangeByName(c).Formula,'error':calc.getCellRangeByName(c).Error,'string':calc.getCellRangeByName(c).String} for c in ['B2','B3']]
            doc.calculateAll()
            report['selfReopenAfterCalculate']=[{'formula':calc.getCellRangeByName(c).Formula,'error':calc.getCellRangeByName(c).Error,'string':calc.getCellRangeByName(c).String} for c in ['B2','B3']]
            roundtrip=root/'roundtrip.xlsx';doc.storeAsURL(roundtrip.as_uri(),(prop('FilterName','Calc MS Excel 2007 XML'),));doc.close(True);doc=None
            with zipfile.ZipFile(roundtrip) as z:
                report['roundtripWorksheetXml']=z.read('xl/worksheets/sheet1.xml').decode()
        finally:
            if doc is not None:doc.close(True)
            if desktop is not None:desktop.terminate()
            try:proc.wait(timeout=5)
            except subprocess.TimeoutExpired:proc.terminate();proc.wait(timeout=3)
    report['engineExitCode']=proc.returncode
report['cleanup']='private process/profile/files removed';pathlib.Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
