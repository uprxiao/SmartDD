#!/usr/bin/env python3
"""Independent ZIP/XML readback for the public synthetic W22 workbook."""
import hashlib
import json
import pathlib
import posixpath
import sys
import xml.etree.ElementTree as ET
import zipfile

path = pathlib.Path(sys.argv[1])
ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
relationship = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
with zipfile.ZipFile(path) as archive:
    book = ET.fromstring(archive.read('xl/workbook.xml'))
    sheets = book.findall('m:sheets/m:sheet', ns)
    relationships = {node.attrib['Id']: node.attrib['Target']
                     for node in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
    calc = next(node for node in sheets if node.attrib['name'] == 'Calc')
    target = relationships[calc.attrib[relationship]]
    part = target.lstrip('/') if target.startswith('/') else posixpath.normpath(posixpath.join('xl', target))
    sheet = ET.fromstring(archive.read(part))
    formula = sheet.find('.//m:c[@r="B2"]/m:f', ns)
    print(json.dumps({
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'sheets': [node.attrib for node in sheets],
        'formulaB2': formula.text if formula is not None else None,
        'parts': {name: hashlib.sha256(archive.read(name)).hexdigest() for name in archive.namelist()},
    }, ensure_ascii=False))
