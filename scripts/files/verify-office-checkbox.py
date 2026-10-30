#!/usr/bin/env python3
"""Independent, read-only legacy checkbox check on synthetic Office test files.

Run with the pinned LibreOffice Resources/python where the OS permits it.
On macOS 26.6.1 the bundled Python launch constraint currently blocks this path;
use verify-office-checkbox-roundtrip.py for the supported CLI check.
This is an engine integration
check, not App/UI acceptance. Never use the user's profile or enable macros.
"""
import argparse
import hashlib
import json
import pathlib
import subprocess
import tempfile
import time
import uuid
import uno
from com.sun.star.document.MacroExecMode import NEVER_EXECUTE
from com.sun.star.document.UpdateDocMode import NO_UPDATE


def prop(name, value):
    result = uno.createUnoStruct('com.sun.star.beans.PropertyValue')
    result.Name, result.Value = name, value
    return result


parser = argparse.ArgumentParser()
parser.add_argument('--runtime', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('files', nargs='+')
args = parser.parse_args()
runtime = pathlib.Path(args.runtime).resolve()
files = [pathlib.Path(value).resolve(strict=True) for value in args.files]
digests = {str(file): hashlib.sha256(file.read_bytes()).hexdigest() for file in files}
report = {'layer': 'independent headless engine readback, no App acceptance',
          'macroExecutionMode': NEVER_EXECUTE, 'updateDocMode': NO_UPDATE,
          'runtime': str(runtime), 'files': []}
assert NEVER_EXECUTE == 0 and NO_UPDATE == 0
with tempfile.TemporaryDirectory(prefix='willyou-m9-checkbox-reader-') as work:
    pipe = 'willyou_' + uuid.uuid4().hex
    proc = subprocess.Popen([str(runtime / 'Contents/MacOS/soffice'),
                             '-env:UserInstallation=' + (pathlib.Path(work) / 'profile').as_uri(),
                             '--headless', '--norestore', '--nodefault', '--nofirststartwizard',
                             f'--accept=pipe,name={pipe};urp;StarOffice.ComponentContext'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    desktop = doc = None
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        context = None
        for _ in range(150):
            if proc.poll() is not None:
                raise RuntimeError('LibreOffice exited before connecting')
            try:
                context = resolver.resolve(f'uno:pipe,name={pipe};urp;StarOffice.ComponentContext')
                break
            except Exception:
                time.sleep(0.1)
        if context is None:
            raise TimeoutError('LibreOffice UNO connection timed out')
        desktop = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
        options = (prop('Hidden', True), prop('ReadOnly', True),
                   prop('MacroExecutionMode', NEVER_EXECUTE), prop('UpdateDocMode', NO_UPDATE))
        for file in files:
            doc = desktop.loadComponentFromURL(file.as_uri(), '_blank', 0, options)
            if doc is None:
                raise RuntimeError('Document could not be opened')
            controls = []
            for sheet in doc.Sheets:
                for shape in sheet.DrawPage:
                    if not shape.supportsService('com.sun.star.drawing.ControlShape'):
                        continue
                    model = shape.Control
                    if not model.supportsService('com.sun.star.form.component.CheckBox'):
                        continue
                    binding = model.getValueBinding()
                    if not binding:
                        raise AssertionError('Checkbox binding was lost')
                    address = binding.BoundCell
                    value = doc.Sheets.getByIndex(address.Sheet).getCellByPosition(address.Column, address.Row).Value
                    assert model.State in (0, 1) and model.State == value
                    controls.append({'name': model.Name, 'label': model.Label, 'state': model.State,
                                     'sheet': address.Sheet, 'row': address.Row, 'column': address.Column,
                                     'cell': value})
            assert controls, 'No form checkbox survived independent readback'
            doc.close(True)
            doc = None
            assert hashlib.sha256(file.read_bytes()).hexdigest() == digests[str(file)]
            report['files'].append({'path': str(file), 'sha256': digests[str(file)], 'controls': controls})
        report['status'] = 'passed'
    except Exception as error:
        report['status'], report['error'] = 'failed', repr(error)
    finally:
        if doc is not None:
            doc.close(True)
        if desktop is not None:
            desktop.terminate()
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        report['processExit'] = proc.returncode
pathlib.Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
raise SystemExit(report['status'] != 'passed')
