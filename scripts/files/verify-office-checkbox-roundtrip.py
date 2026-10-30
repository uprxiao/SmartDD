#!/usr/bin/env python3
"""Read back synthetic checkbox fixtures through signed LibreOffice CLI.

The generated exports are verification artifacts, never production save output.
"""
import argparse
import hashlib
import json
import pathlib
import posixpath
import re
import shutil
import subprocess
import tempfile
import traceback
import xml.etree.ElementTree as ET
import zipfile

MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
VML = 'urn:schemas-microsoft-com:vml'
EXCEL = 'urn:schemas-microsoft-com:office:excel'
OFFICE = 'urn:schemas-microsoft-com:office:office'


def read_controls(path, exported=False):
    result = []
    with zipfile.ZipFile(path) as archive:
        assert not any('vbaproject' in n.lower() or '/externalLinks/' in n for n in archive.namelist()), 'Synthetic fixture must not contain executable macros or linked workbooks'
        def relationships(part):
            name = posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part) + '.rels')
            if name not in archive.namelist():
                return {}
            return {node.attrib['Id']: posixpath.normpath(posixpath.join(posixpath.dirname(part), node.attrib['Target'])).lstrip('/') for node in ET.fromstring(archive.read(name)) if node.attrib.get('TargetMode') != 'External'}
        book = ET.fromstring(archive.read('xl/workbook.xml'))
        book_rels = relationships('xl/workbook.xml')
        for sheet in book.findall('.//{%s}sheet' % MAIN):
            part = book_rels[sheet.attrib['{%s}id' % REL]]
            xml = ET.fromstring(archive.read(part))
            rels = relationships(part)
            cells = {cell.attrib['r']: cell for cell in xml.findall('.//{%s}c' % MAIN)}
            vml_nodes = xml.findall('{%s}legacyDrawing' % MAIN)
            if not vml_nodes:
                continue
            vml = ET.fromstring(archive.read(rels[vml_nodes[0].attrib['{%s}id' % REL]]))
            for control in xml.findall('.//{%s}control' % MAIN):
                prop = ET.fromstring(archive.read(rels[control.attrib['{%s}id' % REL]]))
                if prop.attrib.get('objectType') != 'CheckBox':
                    continue
                link = prop.attrib['fmlaLink']
                match = re.fullmatch(r"(?:(?:'((?:[^']|'')+)'|([^'!]+))!)?(\$?[A-Z]+\$?[1-9][0-9]*)", link)
                assert match, link
                if match[1] or match[2]:
                    assert (match[1].replace("''", "'") if match[1] else match[2]) == sheet.attrib['name']
                address = match[3].replace('$', '')
                cell = cells[address]
                value = cell.find('{%s}v' % MAIN).text
                state = prop.attrib.get('checked', 'Unchecked')
                formula = cell.find('{%s}f' % MAIN)
                # LibreOffice serialises imported literal booleans as TRUE()/FALSE().
                # Accept that exact semantic form only in its verification export.
                boolean_formula = exported and formula is not None and formula.text == ('TRUE()' if value == '1' else 'FALSE()')
                assert state in ('Checked', 'Unchecked') and value in ('0', '1') and (cell.attrib.get('t') == 'b' or boolean_formula)
                assert (state == 'Checked') == (value == '1')
                shapes = [shape for shape in vml.findall('.//{%s}shape' % VML) if shape.attrib.get('{%s}spid' % OFFICE, shape.attrib.get('id')) == '_x0000_s' + control.attrib['shapeId']]
                assert len(shapes) == 1
                data = shapes[0].find('{%s}ClientData' % EXCEL)
                checked = data.find('{%s}Checked' % EXCEL)
                assert (checked is not None and checked.text == '1') == (state == 'Checked')
                binding = data.find('{%s}FmlaLink' % EXCEL)
                assert binding is not None and binding.text.replace('$', '').split('!')[-1] == address
                result.append({'sheet': sheet.attrib['name'], 'cell': address, 'checked': state == 'Checked', 'storage': {'type': cell.attrib.get('t'), 'formula': formula.text if formula is not None else None}})
    return sorted(result, key=lambda v: (v['sheet'], v['cell'], v['checked']))


parser = argparse.ArgumentParser()
parser.add_argument('--runtime', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('files', nargs='+')
args = parser.parse_args()
runtime = pathlib.Path(args.runtime).resolve(strict=True)
work = pathlib.Path(tempfile.mkdtemp(prefix='willyou-m9-checkbox-roundtrip-'))
profile = work / 'profile'
(profile / 'user').mkdir(parents=True)
(profile / 'user/registrymodifications.xcu').write_text('''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item></oor:items>''')
output = work / 'output'
output.mkdir()
report = {'layer': 'independent LibreOffice roundtrip, no App acceptance', 'work': str(work), 'runtime': str(runtime), 'files': [], 'macrosDisabled': True}
try:
    report['version'] = subprocess.run([str(runtime / 'Contents/MacOS/soffice'), '--headless', '--version'], check=True, text=True, capture_output=True, timeout=15).stdout.strip()
    assert report['version'].startswith('LibreOffice 26.2.4.2 ')
    for source in map(pathlib.Path, args.files):
        source = source.resolve(strict=True)
        before_hash = hashlib.sha256(source.read_bytes()).hexdigest()
        before = read_controls(source)
        assert before, 'Input must contain real form checkbox controls'
        copied = work / source.name
        shutil.copy2(source, copied)
        result = subprocess.run([str(runtime / 'Contents/MacOS/soffice'), '-env:UserInstallation=' + profile.as_uri(), '--headless', '--norestore', '--nodefault', '--nofirststartwizard', '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', str(output), str(copied)], text=True, capture_output=True, timeout=45)
        exported = output / source.name
        assert result.returncode == 0 and exported.is_file(), (result.returncode, result.stdout, result.stderr)
        after = read_controls(exported, True)
        semantic = lambda rows: [{key: value for key, value in row.items() if key != 'storage'} for row in rows]
        assert semantic(after) == semantic(before), (before, after)
        assert hashlib.sha256(source.read_bytes()).hexdigest() == before_hash
        report['files'].append({'source': str(source), 'sha256': before_hash, 'export': str(exported), 'exportSHA256': hashlib.sha256(exported.read_bytes()).hexdigest(), 'controlsBefore': before, 'controlsAfter': after, 'stdout': result.stdout})
    report['status'] = 'passed'
except Exception as error:
    report['status'], report['error'] = 'failed', repr(error)
    report['traceback'] = traceback.format_exc()
pathlib.Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False))
raise SystemExit(report['status'] != 'passed')
