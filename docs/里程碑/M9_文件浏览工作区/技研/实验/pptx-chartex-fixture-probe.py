"""Isolated ChartEx feasibility fixtures, never production save candidates.

The input is LibreOffice's funnel-pp1.pptx (Git blob pinned below), downloaded
separately. Generated variants remove its image fallback and use synthetic data.
No external fixture is committed or loaded outside the native rendering sandbox.
"""
import hashlib
import io
import json
import pathlib
import sys
import xml.etree.ElementTree as E
import zipfile

CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
for prefix, uri in [('cx', CX), ('a', A), ('p', P), ('r', R), ('mc', MC)]:
    E.register_namespace(prefix, uri)


def xml(root):
    return E.tostring(root, encoding='utf-8', xml_declaration=True)


def archive(parts):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    return buf.getvalue()


def workbook(values):
    rows = '<row r="1"><c r="A1" t="inlineStr"><is><t>Category</t></is></c><c r="B1" t="inlineStr"><is><t>Value</t></is></c></row>'
    for i, value in enumerate(values, 2):
        rows += f'<row r="{i}"><c r="A{i}" t="inlineStr"><is><t>Item {i-1}</t></is></c><c r="B{i}"><v>{value}</v></c></row>'
    return archive({
        '[Content_Types].xml': f'<Types xmlns="{CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        '_rels/.rels': f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="{R}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': f'<workbook xmlns="{S}" xmlns:r="{R}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="{R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': f'<worksheet xmlns="{S}"><sheetData>{rows}</sheetData></worksheet>',
    })


def chart(kind, values):
    count = len(values)
    categories = ''.join(f'<cx:pt idx="{i}">Item {i+1}</cx:pt>' for i in range(count))
    points = ''.join(f'<cx:pt idx="{i}">{v}</cx:pt>' for i, v in enumerate(values))
    category = '' if kind == 'histogram' else f'<cx:strDim type="cat"><cx:f>Sheet1!$A$2:$A${count+1}</cx:f><cx:lvl ptCount="{count}">{categories}</cx:lvl></cx:strDim>'
    layout = {'histogram': 'clusteredColumn'}.get(kind, kind)
    layout_properties = '<cx:binning intervalClosed="r"><cx:binCount>3</cx:binCount></cx:binning>' if kind == 'histogram' else ''
    dimension = 'size' if kind == 'treemap' else 'val'
    axes = '' if kind == 'treemap' else '<cx:axis id="0"><cx:catScaling gapWidth="0.2"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>'
    return f'''<cx:chartSpace xmlns:cx="{CX}" xmlns:a="{A}" xmlns:r="{R}">
      <cx:chartData><cx:externalData r:id="rId1" autoUpdate="0"/><cx:data id="0">{category}<cx:numDim type="{dimension}"><cx:f>Sheet1!$B$2:$B${count+1}</cx:f><cx:lvl ptCount="{count}" formatCode="General">{points}</cx:lvl></cx:numDim></cx:data></cx:chartData>
      <cx:chart><cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>{kind}</cx:v></cx:txData></cx:tx></cx:title><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="{layout}" uniqueId="{{7E1798A4-F77B-4EDD-98BD-7520ED730BC7}}"><cx:tx><cx:txData><cx:f>Sheet1!$B$1</cx:f><cx:v>Value</cx:v></cx:txData></cx:tx><cx:dataId val="0"/><cx:layoutPr>{layout_properties}</cx:layoutPr></cx:series></cx:plotAreaRegion>{axes}</cx:plotArea></cx:chart>
    </cx:chartSpace>'''.encode()


def main():
    source, output = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    raw = source.read_bytes()
    assert hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest() == 'df34aa1618d0d4900739753f779560b24926197d'
    output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        base = {n: z.read(n) for n in z.namelist()}
    slide = E.fromstring(base['ppt/slides/slide1.xml'])
    tree = slide.find(f'{{{P}}}cSld/{{{P}}}spTree')
    alternate = tree.find(f'{{{MC}}}AlternateContent')
    graphic = alternate.find(f'{{{MC}}}Choice/{{{P}}}graphicFrame')
    tree.insert(list(tree).index(alternate), graphic)
    tree.remove(alternate)
    assert not slide.findall(f'.//{{{P}}}pic')
    base['ppt/slides/slide1.xml'] = xml(slide)
    results = []
    for kind in ['funnel', 'histogram', 'waterfall', 'treemap']:
        parts = dict(base)
        values = [6, 3, 4, 2, 5]
        parts['ppt/charts/chartEx1.xml'] = chart(kind, values)
        parts['ppt/embeddings/Microsoft_Excel_Worksheet.xlsx'] = workbook(values)
        path = output / f'{kind}.pptx'
        content = archive(parts)
        path.write_bytes(content)
        results.append({'type': kind, 'values': values, 'file': path.name, 'sha256': hashlib.sha256(content).hexdigest(), 'fallbackRemoved': True})
    (output / 'fixtures.json').write_text(json.dumps({'source': 'https://github.com/LibreOffice/core/blob/master/chart2/qa/extras/data/pptx/funnel-pp1.pptx', 'sourceGitBlob': 'df34aa1618d0d4900739753f779560b24926197d', 'fixtures': results}, indent=2) + '\n')
    print(json.dumps(results))


if __name__ == '__main__':
    main()
