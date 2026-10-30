#!/usr/bin/env python3
"""Run with the already-installed LibreOffice Resources/python wrapper.
Uses an ephemeral named pipe and profile; never connects to the user's Office instance.
"""
import argparse, hashlib, json, pathlib, subprocess, tempfile, time, uuid, zipfile
import xml.etree.ElementTree as ET
import uno

def prop(name,value):
    p=uno.createUnoStruct('com.sun.star.beans.PropertyValue'); p.Name=name; p.Value=value; return p
def xml_text(file):
    with zipfile.ZipFile(file) as z:
        return ''.join(''.join(ET.fromstring(z.read(n)).itertext()) for n in z.namelist() if n.endswith('.xml'))
def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--output',required=True); args=parser.parse_args()
    source=pathlib.Path(__file__); report={'startedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'scriptSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'scope':'UNO command capability only; synthetic documents, not SmartDD UI integration','cases':[]}
    with tempfile.TemporaryDirectory(prefix='m9-uno-research-') as directory:
        root=pathlib.Path(directory); pipe='m9_'+uuid.uuid4().hex; profile=root/'profile'
        binary='/Applications/LibreOffice.app/Contents/MacOS/soffice'
        command=[binary,f'-env:UserInstallation={profile.as_uri()}','--headless','--nologo','--nodefault','--norestore',f'--accept=pipe,name={pipe};urp;StarOffice.ComponentContext']
        log=(root/'engine.log').open('wb'); process=subprocess.Popen(command,stdout=log,stderr=log); desktop=None
        try:
            local=uno.getComponentContext(); resolver=local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver',local)
            context=None
            for _ in range(100):
                try: context=resolver.resolve(f'uno:pipe,name={pipe};urp;StarOffice.ComponentContext'); break
                except Exception:
                    if process.poll() is not None: raise RuntimeError(f'Office exited before UNO connection: {process.returncode}')
                    time.sleep(.1)
            if context is None: raise RuntimeError('UNO connection timeout')
            desktop=context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop',context)
            options=(prop('Hidden',True),prop('ReadOnly',False),prop('MacroExecutionMode',uno.getConstantByName('com.sun.star.document.MacroExecMode.NEVER_EXECUTE')),prop('UpdateDocMode',uno.getConstantByName('com.sun.star.document.UpdateDocMode.NO_UPDATE')))
            for kind,factory,filter_name,pdf_filter in [('docx','swriter','Office Open XML Text','writer_pdf_Export'),('xlsx','scalc','Calc MS Excel 2007 XML','calc_pdf_Export'),('pptx','simpress','Impress MS PowerPoint 2007 XML','impress_pdf_Export')]:
                start=time.monotonic(); marker='M9_UNO_AFTER_'+kind.upper(); doc=None
                try:
                    doc=desktop.loadComponentFromURL('private:factory/'+factory,'_blank',0,options)
                    if kind=='docx': doc.Text.String='M9_UNO_BEFORE_DOCX\n原创中文 UNO 文档。'
                    elif kind=='xlsx':
                        sheet=doc.Sheets.getByIndex(0); sheet.getCellRangeByName('A1').String='M9_UNO_BEFORE_XLSX'; sheet.getCellRangeByName('A2').Value=2; sheet.getCellRangeByName('B2').Value=3; sheet.getCellRangeByName('C2').Formula='=SUM(A2:B2)'; doc.calculateAll()
                        doc.Sheets.insertNewByName('Second',1)
                    else:
                        page=doc.DrawPages.getByIndex(0); shape=doc.createInstance('com.sun.star.drawing.TextShape'); point=uno.createUnoStruct('com.sun.star.awt.Point'); point.X=2000;point.Y=2000; size=uno.createUnoStruct('com.sun.star.awt.Size');size.Width=22000;size.Height=5000;shape.Position=point;shape.Size=size;page.add(shape);shape.String='M9_UNO_BEFORE_PPTX'; doc.DrawPages.insertNewByIndex(1)
                    original=root/('original.'+kind); doc.storeAsURL(original.as_uri(),(prop('FilterName',filter_name),)); doc.close(True); doc=None
                    doc=desktop.loadComponentFromURL(original.as_uri(),'_blank',0,options)
                    if kind=='docx': doc.Text.String=marker+'\n原创中文 UNO 文档。'
                    elif kind=='xlsx': doc.Sheets.getByIndex(0).getCellRangeByName('A1').String=marker; doc.Sheets.getByIndex(0).getCellRangeByName('B2').Value=10; doc.calculateAll()
                    else:
                        page=doc.DrawPages.getByIndex(0)
                        for i in range(page.Count):
                            shape=page.getByIndex(i)
                            if hasattr(shape,'String') and 'M9_UNO_BEFORE_PPTX' in shape.String: shape.String=marker
                    edited=root/('edited.'+kind); doc.storeAsURL(edited.as_uri(),(prop('FilterName',filter_name),)); pdf=root/(kind+'.pdf');doc.storeToURL(pdf.as_uri(),(prop('FilterName',pdf_filter),))
                    info={'format':kind,'status':'command-edit-and-export-passed','markerInOOXML':marker in xml_text(edited),'bytes':edited.stat().st_size,'sha256':hashlib.sha256(edited.read_bytes()).hexdigest()}
                    if kind=='xlsx': info['calculatedValueInEngine']=doc.Sheets.getByIndex(0).getCellRangeByName('C2').Value; info['sheetCount']=doc.Sheets.Count
                    if kind=='pptx':info['slideCount']=doc.DrawPages.Count
                    read=subprocess.run(['/opt/homebrew/bin/pdftotext',str(pdf),'-'],capture_output=True,timeout=20);info['markerInPopplerText']=marker in read.stdout.decode('utf-8','replace');info['visualLayoutVerified']=False
                    if not info['markerInOOXML'] or not info['markerInPopplerText']: info['status']='verification-failed'
                    report['cases'].append(info)
                except Exception as e: report['cases'].append({'format':kind,'status':'failed','error':str(e)})
                finally:
                    if doc is not None:
                        try:doc.close(True)
                        except Exception:pass
                    report['cases'][-1]['durationMs']=round((time.monotonic()-start)*1000,2)
        except Exception as e:report['startupError']=str(e)
        finally:
            if desktop is not None:
                try:desktop.terminate()
                except Exception:pass
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:process.wait(timeout=3)
                except subprocess.TimeoutExpired:process.kill();process.wait()
            log.close();report['engineExitCode']=process.returncode;report['engineLog']=(root/'engine.log').read_text(errors='replace').replace(str(root),'<fixture>')
    report['cleanup']='private profile, pipe process and fixtures removed';report['completedAt']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
    pathlib.Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
    if report.get('startupError') or any(c['status']!='command-edit-and-export-passed' for c in report['cases']):raise SystemExit(1)
if __name__=='__main__':main()
