#!/usr/bin/env python3
"""Synthetic-only table layout research. Never render the generated SVG in UI.

Private cell fills identify native polygons without changing text/row layout.
This does not establish the production sandbox integration or full compatibility.
"""
import argparse
import hashlib
import json
import os
import pathlib
import posixpath
import re
import subprocess
import xml.etree.ElementTree as E
from zipfile import ZipFile

A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
P = '{http://schemas.openxmlformats.org/presentationml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
S = '{http://www.w3.org/2000/svg}'
for name, uri in [('a', A), ('p', P), ('r', R)]:
    E.register_namespace(name, uri[1:-1])


def export(runtime, source, output, profile):
    output.mkdir(parents=True)
    command = [str(runtime / 'Contents/MacOS/soffice'), '-env:UserInstallation=' + profile.as_uri(), '--headless', '--norestore', '--nodefault', '--convert-to', 'svg:impress_svg_Export', '--outdir', str(output), str(source)]
    result = subprocess.run(command, capture_output=True, timeout=25, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
    (output / 'stdout.txt').write_bytes(result.stdout)
    (output / 'stderr.txt').write_bytes(result.stderr)
    result.check_returncode()
    svg = output / (source.stem + '.svg')
    assert svg.stat().st_size < 40 * 1024 * 1024
    return svg


def text_positions(root):
    return [E.tostring(node, encoding='unicode') for node in root.iter(S + 'text') if node.get('class') == 'SVGTextShape']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    runtime, source, output = (pathlib.Path(s).resolve() for s in [args.runtime, args.source, args.output])
    output.mkdir(parents=True, exist_ok=False)
    base = output / 'original.pptx'
    base.write_bytes(source.read_bytes())
    replacements, markers = {}, {}
    with ZipFile(base) as file:
        main = E.fromstring(file.read('ppt/presentation.xml'))
        relations = {node.get('Id'): posixpath.normpath(posixpath.join('ppt', node.get('Target'))) for node in E.fromstring(file.read('ppt/_rels/presentation.xml.rels'))}
        size = main.find(P + 'sldSz')
        for slide in main.find(P + 'sldIdLst'):
            part = relations[slide.get(R + 'id')]
            xml = E.fromstring(file.read(part))
            for frame in xml.iter(P + 'graphicFrame'):
                table = frame.find('.//' + A + 'tbl')
                if table is None:
                    continue
                element_id = frame.find('.//' + P + 'cNvPr').get('id')
                for row, tr in enumerate(table.findall(A + 'tr')):
                    for column, tc in enumerate(tr.findall(A + 'tc')):
                        if tc.get('hMerge') in ['1', 'true'] or tc.get('vMerge') in ['1', 'true']:
                            continue
                        marker = 0x010000 + len(markers) + 1
                        assert marker < 0xFFFFFF
                        rgb = f'#{marker:06x}'
                        markers[rgb] = {'slideId': slide.get('id'), 'elementId': element_id, 'row': row, 'column': column}
                        props = tc.find(A + 'tcPr')
                        if props is None:
                            props = E.SubElement(tc, A + 'tcPr')
                        for child in list(props):
                            if child.tag in [A + name for name in ['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']]:
                                props.remove(child)
                        fill = E.Element(A + 'solidFill')
                        E.SubElement(fill, A + 'srgbClr', val=rgb[1:].upper())
                        before = next((i for i, n in enumerate(props) if n.tag in [A + 'headers', A + 'extLst']), len(props))
                        props.insert(before, fill)
            replacements[part] = E.tostring(xml, encoding='utf-8', xml_declaration=True)
        marked = output / 'marked.pptx'
        with ZipFile(marked, 'w') as target:
            for entry in file.infolist():
                target.writestr(entry, replacements.get(entry.filename, file.read(entry.filename)))
    original_svg = export(runtime, base, output / 'original-svg', output / 'original-profile')
    marked_svg = export(runtime, marked, output / 'marked-svg', output / 'marked-profile')
    original, actual = E.parse(original_svg).getroot(), E.parse(marked_svg).getroot()
    assert text_positions(original) == text_positions(actual), 'cell markers changed native text layout'
    view = [float(v) for v in actual.get('viewBox').split()]
    scales = [int(size.get('cx')) / 12700 / view[2], int(size.get('cy')) / 12700 / view[3]]
    found = {}
    for table in actual.iter(S + 'g'):
        if table.get('class') != 'com.sun.star.drawing.TableShape':
            continue
        for node in table.iter(S + 'path'):
            match = re.fullmatch(r'rgb\((\d+),(\d+),(\d+)\)', node.get('fill', ''))
            if not match:
                continue
            color = '#' + ''.join(f'{int(v):02x}' for v in match.groups())
            if color not in markers:
                continue
            assert color not in found, 'ambiguous cell marker'
            d = node.get('d', '')
            assert not re.sub(r'[MLZmlz0-9.,\s+-]', '', d), 'unexpected cell path command'
            numbers = [float(v) for v in re.findall(r'[-+]?\d*\.?\d+', d)]
            assert len(numbers) == 10 and numbers[:2] == numbers[-2:], 'unexpected cell polygon'
            points = [[numbers[i] * scales[0], numbers[i+1] * scales[1]] for i in range(0, 8, 2)]
            found[color] = {**markers[color], 'points': points}
    assert set(found) == set(markers), 'missing native cell polygons'
    report = {'scope': 'Synthetic layout experiment; no production integration or App acceptance', 'sourceHash': hashlib.sha256(base.read_bytes()).hexdigest(), 'sourceUnchanged': base.read_bytes() == source.read_bytes(), 'cellCount': len(found), 'textLayoutUnchanged': True, 'geometry': list(found.values()), 'originalSVGHash': hashlib.sha256(original_svg.read_bytes()).hexdigest(), 'markedSVGHash': hashlib.sha256(marked_svg.read_bytes()).hexdigest()}
    (output / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k != 'geometry'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
