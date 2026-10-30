#!/usr/bin/env python3
"""Read layout capability from the fixed engine on a synthetic PPTX only.

Run with LibreOffice's Resources/python wrapper and PYTHONDONTWRITEBYTECODE=1.
This is an isolated research probe, not the production sandbox or App acceptance.
"""
import argparse
import json
import os
import pathlib
import subprocess
import tempfile
import time
import uuid
import uno


def prop(name, value):
    item = uno.createUnoStruct('com.sun.star.beans.PropertyValue')
    item.Name, item.Value = name, value
    return item


def selected_properties(obj):
    properties = obj.getPropertySetInfo().getProperties()
    names = [p.Name for p in properties]
    values = {}
    for name in names:
        if any(word in name.lower() for word in ['height', 'width', 'size', 'position', 'bound', 'optimal']):
            try:
                values[name] = str(obj.getPropertyValue(name))
            except Exception as error:
                values[name] = str(error)
    return {'names': names, 'dimensions': values}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    runtime, source = pathlib.Path(args.runtime).resolve(), pathlib.Path(args.source).resolve()
    report = {'scope': 'Synthetic headless UNO layout capability; not App acceptance', 'tables': []}
    with tempfile.TemporaryDirectory(prefix='wy-table-layout-', dir='/private/tmp') as temp:
        root = pathlib.Path(temp)
        private = root / 'source.pptx'
        private.write_bytes(source.read_bytes())
        pipe = 'wy_table_' + uuid.uuid4().hex
        command = [str(runtime / 'Contents/MacOS/soffice'), '-env:UserInstallation=' + (root / 'profile').as_uri(), '--headless', '--nologo', '--nodefault', '--norestore', '--nofirststartwizard', '--accept=pipe,name=' + pipe + ';urp;StarOffice.ComponentContext']
        with (root / 'engine.log').open('wb') as log:
            process = subprocess.Popen(command, stdout=log, stderr=log, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
            desktop = doc = None
            try:
                local = uno.getComponentContext()
                resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
                context = None
                for _ in range(100):
                    try:
                        context = resolver.resolve('uno:pipe,name=' + pipe + ';urp;StarOffice.ComponentContext')
                        break
                    except Exception:
                        if process.poll() is not None:
                            raise RuntimeError('engine exited before connection')
                        time.sleep(.1)
                if context is None:
                    raise RuntimeError('private engine connection timed out')
                desktop = context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
                options = (prop('Hidden', True), prop('ReadOnly', True), prop('MacroExecutionMode', uno.getConstantByName('com.sun.star.document.MacroExecMode.NEVER_EXECUTE')), prop('UpdateDocMode', uno.getConstantByName('com.sun.star.document.UpdateDocMode.NO_UPDATE')))
                doc = desktop.loadComponentFromURL(private.as_uri(), '_blank', 0, options)
                doc.storeToURL((root / 'layout.pdf').as_uri(), (prop('FilterName', 'impress_pdf_Export'),))
                for page_index in range(doc.DrawPages.Count):
                    page = doc.DrawPages.getByIndex(page_index)
                    for index in range(page.Count):
                        shape = page.getByIndex(index)
                        if not shape.supportsService('com.sun.star.drawing.TableShape'):
                            continue
                        table = shape.Model
                        report['tables'].append({'page': page_index, 'index': index, 'name': shape.Name, 'shape': selected_properties(shape), 'rows': [selected_properties(table.Rows.getByIndex(i)) for i in range(table.Rows.Count)], 'cell': selected_properties(table.getCellByPosition(0, 0)), 'cellInterfaces': [t.typeName for t in table.getCellByPosition(0, 0).getTypes()]})
            finally:
                if doc is not None:
                    doc.close(True)
                if desktop is not None:
                    desktop.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    pathlib.Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
