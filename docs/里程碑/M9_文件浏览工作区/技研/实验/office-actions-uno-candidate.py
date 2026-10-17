#!/usr/bin/env python3
"""Generate a disposable engine candidate from the parent probe's synthetic fixture.
Run with LibreOffice's bundled Python. Never installs or overwrites the input.
"""
import argparse, hashlib, json, pathlib, subprocess, tempfile, time, uuid, zipfile
import xml.etree.ElementTree as ET
import uno


def prop(name, value):
    p = uno.createUnoStruct('com.sun.star.beans.PropertyValue'); p.Name = name; p.Value = value; return p


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--input', required=True); ap.add_argument('--candidate', required=True); ap.add_argument('--output', required=True); args = ap.parse_args()
    source = pathlib.Path(args.input).resolve(); candidate = pathlib.Path(args.candidate).resolve()
    if source == candidate or candidate.exists(): raise ValueError('candidate must be a new disposable file')
    original_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    report = {'scope': 'Synthetic input owned by office-actions-probe; candidate is not a save result', 'scriptSha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()}
    options = (prop('Hidden', True), prop('MacroExecutionMode', uno.getConstantByName('com.sun.star.document.MacroExecMode.NEVER_EXECUTE')), prop('UpdateDocMode', uno.getConstantByName('com.sun.star.document.UpdateDocMode.NO_UPDATE')))
    with tempfile.TemporaryDirectory(prefix='m9-actions-uno-') as temp:
        root = pathlib.Path(temp); pipe = 'm9_' + uuid.uuid4().hex; desktop = None; doc = None
        with (root / 'engine.log').open('wb') as log:
            proc = subprocess.Popen(['/Applications/LibreOffice.app/Contents/MacOS/soffice', '-env:UserInstallation='+(root/'profile').as_uri(), '--headless', '--norestore', '--nodefault', f'--accept=pipe,name={pipe};urp;StarOffice.ComponentContext'], stdout=log, stderr=log)
            try:
                local = uno.getComponentContext(); resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local); context = None
                for _ in range(100):
                    try: context = resolver.resolve(f'uno:pipe,name={pipe};urp;StarOffice.ComponentContext'); break
                    except Exception: time.sleep(.1)
                if context is None: raise RuntimeError('UNO timeout')
                desktop = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
                doc = desktop.loadComponentFromURL(source.as_uri(), '_blank', 0, options)
                if doc is None: raise RuntimeError('synthetic input not loaded')
                calc = doc.Sheets.getByName('Calc'); doc.calculateAll()
                report['beforeValues'] = [calc.getCellRangeByName(c).Value for c in ['B2', 'B3', 'B4']]
                doc.Sheets.removeByName('Data'); doc.calculateAll()
                report['engineCells'] = [{'cell': c, 'formula': calc.getCellRangeByName(c).Formula, 'error': calc.getCellRangeByName(c).Error, 'value': calc.getCellRangeByName(c).Value} for c in ['B2', 'B3', 'B4']]
                doc.storeAsURL(candidate.as_uri(), (prop('FilterName', 'Calc MS Excel 2007 XML'),)); doc.close(True); doc = None
                ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                with zipfile.ZipFile(candidate) as z:
                    report['candidateWorksheetXml'] = z.read('xl/worksheets/sheet1.xml').decode()
                    report['candidateCells'] = [{'cell': c.get('r'), 'formula': c.findtext('s:f', namespaces=ns), 'value': c.findtext('s:v', namespaces=ns), 'type': c.get('t')} for c in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:c', ns) if c.find('s:f', ns) is not None]
                assert hashlib.sha256(source.read_bytes()).hexdigest() == original_hash
                report['originalUnchanged'] = True
            finally:
                if doc is not None: doc.close(True)
                if desktop is not None: desktop.terminate()
                try: proc.wait(timeout=5)
                except subprocess.TimeoutExpired: proc.terminate(); proc.wait(timeout=3)
        report['engineExitCode'] = proc.returncode
    report['cleanup'] = 'Private process/profile removed; candidate lifecycle belongs to the parent probe'
    pathlib.Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')


if __name__ == '__main__': main()
