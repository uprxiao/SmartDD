#!/usr/bin/env python3
"""Versioned F18 inputs from the original rich_xlsx definition; no App or Office.

Run with the pinned Python -B -I -S and the frozen pure Python dependencies.
The original XLSM is copied byte-for-byte, never loaded by an Office program.
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.pycache_prefix = str(HERE / 'cache/python')
sys.path.insert(0, str(HERE / 'pydeps'))

import argparse
import copy
import datetime
import hashlib
import json
import shutil
import xml.etree.ElementTree as E
import zipfile

S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
R = 'http://schemas.openxmlformats.org/package/2006/relationships'
C = 'http://schemas.openxmlformats.org/package/2006/content-types'
NS = {'x': S}
MACRO_SHA = 'f76c986f4ebc25c2cc57c088b2511a1269f4bd61d6223a2ab58db351da348ba6'
VBA_SHA = 'f9becb822f01de291b0ec95ea4061235e1f98ea31f80d840009a6caab829ce90'
FORMULAS = {
    'B2': '=Data!$B$2+Data!B3', 'B3': '=SUM(Data!B2:B3)',
    'B4': '=IF("Data!B2"="Data!B2",100,0)', 'B5': '=IFERROR(Data!B2,77)',
    'B6': '=IF(FALSE,Data!B2,42)', 'B7': '=IFERROR(B2,88)',
    'B8': '=SUM(InputTotal)', 'B9': '=SUM(Sales[Value])',
    'B10': '=SUM(Data:Spare!A1)', 'B11': '=Data!B2*2',
    'B12': '=Data!B3*2', 'B15': '=IFERROR(SUM(Data!B2:B3),99)',
    'B16': '=IFERROR(INDIRECT("Data!B2"),66)',
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def parts(path):
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        return {name: archive.read(name) for name in archive.namelist()}

def xml(node):
    return E.tostring(node, encoding='utf-8', xml_declaration=True)

def write_zip(path, entries):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(entries):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 20, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, entries[name], compresslevel=9)

def create_xlsx(path):
    # The original predev rich_xlsx function, not current product output, is the
    # source of all sheets, values, formulas, table, chart and style below.
    from openpyxl import Workbook
    from openpyxl.chart import BarChart, Reference
    from openpyxl.styles import Font
    from openpyxl.workbook.defined_name import DefinedName
    from openpyxl.worksheet.formula import ArrayFormula
    from openpyxl.worksheet.table import Table, TableStyleInfo

    w = Workbook()
    d = w.active
    d.title = 'Data'
    c = w.create_sheet('Calc')
    spare = w.create_sheet('Spare')
    d.append(['Label', 'Value'])
    d.append(['A', 3])
    d.append(['B', 4])
    spare['A1'] = 5
    table = Table(displayName='Sales', ref='A1:B3')
    table.tableStyleInfo = TableStyleInfo(name='TableStyleMedium9', showRowStripes=True)
    d.add_table(table)
    chart = BarChart()
    chart.add_data(Reference(d, min_col=2, min_row=1, max_row=3), titles_from_data=True)
    d.add_chart(chart, 'E2')
    w.defined_names.add(DefinedName('InputTotal', attr_text="'Data'!$B$2:$B$3"))
    for address, formula in FORMULAS.items():
        c[address] = formula
        c['A' + address[1:]] = address
    c['D2'] = ArrayFormula('D2:D3', '=Data!B2:B3*3')
    c['D3'] = 0
    c['E2'] = 123.456
    c['E3'] = 789
    c['E2'].font = Font(name='Arial', bold=True, color='FF123456')
    c['E2'].number_format = '0.00'
    c['E3'].font = copy.copy(c['E2'].font)
    c['G2'] = 'MERGE_TOP'
    c['H2'] = 'MERGE_COVERED'
    # Exact additional feature required by the original F18 UI and I drivers.
    d['A5'] = 'MERGED_PREVIEW_中文'
    d.merge_cells('A5:B5')
    w.properties.created = datetime.datetime(2026, 10, 20)
    w.properties.modified = datetime.datetime(2026, 10, 20)
    w.save(path)
    entries = parts(path)
    core = E.fromstring(entries['docProps/core.xml'])
    for tag in ['created', 'modified']:
        node = core.find('{http://purl.org/dc/terms/}' + tag)
        assert node is not None
        node.text = '2026-10-20T00:00:00Z'
    entries['docProps/core.xml'] = xml(core)
    sheet = E.fromstring(entries['xl/worksheets/sheet2.xml'])
    cells = {cell.get('r'): cell for cell in sheet.findall('.//x:c', NS)}
    for address in ['B11', 'B12']:
        formula = cells[address].find('x:f', NS)
        formula.set('t', 'shared')
        formula.set('si', '7')
        if address == 'B11':
            formula.set('ref', 'B11:B12')
        else:
            formula.text = None
    entries['xl/worksheets/sheet2.xml'] = xml(sheet)
    opaque = 'customXml/m9-opaque.bin'
    entries[opaque] = bytes(range(256)) * 4
    types = E.fromstring(entries['[Content_Types].xml'])
    E.SubElement(types, '{' + C + '}Override', {'PartName': '/' + opaque, 'ContentType': 'application/octet-stream'})
    entries['[Content_Types].xml'] = xml(types)
    rels = E.fromstring(entries['_rels/.rels'])
    E.SubElement(rels, '{' + R + '}Relationship', {'Id': 'm9opaque', 'Type': 'urn:smartdd:m9:opaque', 'Target': opaque})
    entries['_rels/.rels'] = xml(rels)
    write_zip(path, entries)

def inspect_xlsx(path):
    entries = parts(path)
    workbook = E.fromstring(entries['xl/workbook.xml'])
    names = [x.get('name') for x in workbook.findall('x:sheets/x:sheet', NS)]
    assert names == ['Data', 'Calc', 'Spare']
    data = E.fromstring(entries['xl/worksheets/sheet1.xml'])
    calc = E.fromstring(entries['xl/worksheets/sheet2.xml'])
    cells = {x.get('r'): x for x in data.findall('.//x:c', NS)}
    text = lambda node: ''.join(x.text or '' for x in node.findall('.//x:t', NS))
    assert text(cells['A1']) == 'Label'
    assert cells['B2'].find('x:v', NS).text == '3' and cells['B3'].find('x:v', NS).text == '4'
    assert text(cells['A5']) == 'MERGED_PREVIEW_中文'
    assert [x.get('ref') for x in data.findall('x:mergeCells/x:mergeCell', NS)] == ['A5:B5']
    cc = {x.get('r'): x for x in calc.findall('.//x:c', NS)}
    assert text(cc['A2']) == 'B2'
    for address, formula in FORMULAS.items():
        node = cc[address].find('x:f', NS)
        if address == 'B12':
            assert node.get('t') == 'shared' and node.get('si') == '7' and node.text is None
        else:
            assert node.text == formula[1:]
    assert cc['B11'].find('x:f', NS).get('ref') == 'B11:B12'
    assert cc['D2'].find('x:f', NS).get('t') == 'array'
    assert cc['D2'].find('x:f', NS).get('ref') == 'D2:D3'
    assert 'xl/tables/table1.xml' in entries and 'xl/charts/chart1.xml' in entries
    table = E.fromstring(entries['xl/tables/table1.xml'])
    assert table.get('name') == 'Sales' and table.get('ref') == 'A1:B3'
    defined = workbook.find('x:definedNames/x:definedName', NS)
    assert defined is not None and defined.get('name') == 'InputTotal' and defined.text == "'Data'!$B$2:$B$3"
    assert entries['customXml/m9-opaque.bin'] == bytes(range(256)) * 4
    assert not any('vbaProject' in name for name in entries)
    return {'sheets': names, 'Data': {'A1': 'Label', 'B2': 3, 'B3': 4, 'A5': 'MERGED_PREVIEW_中文', 'merge': 'A5:B5'},
            'Calc': {'A2': 'B2', 'B2': '=Data!$B$2+Data!B3', 'allOriginalSeedFormulas': FORMULAS,
                     'sharedFormula': 'B11:B12 si7', 'arrayFormula': 'D2:D3'},
            'richFeatures': ['Sales table', 'bar chart', 'InputTotal defined name', 'Arial bold styled E2 and shared font E3',
                             'unmerged G2/H2 covered markers', '1024B opaque part'],
            'parts': {name: digest(value) for name, value in entries.items()}}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--macro', type=Path, required=True)
    args = parser.parse_args()
    assert args.out == HERE / 'fixtures-v2' and not args.out.exists()
    assert not args.macro.is_symlink() and digest(args.macro.read_bytes()) == MACRO_SHA
    macro_parts = parts(args.macro)
    assert len(macro_parts['xl/vbaProject.bin']) == 16384 and digest(macro_parts['xl/vbaProject.bin']) == VBA_SHA
    args.out.mkdir()
    xlsx = args.out / 'rich-merged.xlsx'
    create_xlsx(xlsx)
    oracle = inspect_xlsx(xlsx)
    macro = args.out / 'SimpleMacro.xlsm'
    shutil.copy2(args.macro, macro)
    assert digest(macro.read_bytes()) == MACRO_SHA
    files = []
    for path in [xlsx, macro]:
        files.append({'name': path.name, 'bytes': path.stat().st_size, 'sha256': digest(path.read_bytes()),
                      'parts': {name: digest(value) for name, value in parts(path).items()}})
    manifest = {'version': 'F18-fixtures-v2', 'files': files, 'xlsxOracle': oracle,
                'generatorSHA256': digest(Path(__file__).read_bytes()),
                'sourceDefinition': 'Frozen original predev-office-probe.rich_xlsx plus original F18 driver/I A5:B5 CJK merge',
                'oldXlsxBytesRecovered': False, 'macroExactOldOriginalRecovered': True,
                'oldFixtureManifestRecovered': False, 'original4AExpectedUnchanged': True,
                'generatedByAppUnderTest': False, 'macroExecuted': False, 'OfficeAppNodeExecuted': False,
                'difference': 'New explicit deterministic XLSX ZIP metadata/serialization; original seed semantics retained. Not old8802B/SHA.'}
    (args.out / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'fixtureManifest': str(args.out / 'manifest.json'),
                      'fixtureManifestSHA256': digest((args.out / 'manifest.json').read_bytes()), 'files': files,
                      'AppReady': False, 'original4AStillToRun': True}, ensure_ascii=False))

if __name__ == '__main__':
    main()
