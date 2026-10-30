"""Geometry feasibility only: ChartEx source -> disposable DrawingML projection.

Input ChartEx and embedded data are retained byte for byte. Only the preview
slide changes. This probe does not implement production style/axis inheritance.
"""
import hashlib
import io
import json
import math
import pathlib
import posixpath
import sys
import xml.etree.ElementTree as E
import zipfile

P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
CX = 'http://schemas.microsoft.com/office/drawing/2014/chartex'
S = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
for prefix, uri in [('p', P), ('a', A), ('r', R), ('cx', CX)]:
    E.register_namespace(prefix, uri)


def node(parent, ns, tag, **attrs):
    return E.SubElement(parent, f'{{{ns}}}{tag}', {k: str(v) for k, v in attrs.items()})


def geometry(kind, values, bins):
    assert 1 <= len(values) <= 8 and all(math.isfinite(v) and v >= 0 for v in values)
    maximum = max(values) or 1
    normalized = [v / maximum for v in values]
    total = sum(normalized) or 1
    rectangles = []
    plotted = values
    if kind == 'histogram':
        assert 1 <= bins <= 8
        # Equally sized right-closed bins; the first includes the minimum.
        low, high = min(values), max(values)
        counts = [0] * (bins if high > low else 1)
        for value in values:
            index = 0 if high == low else min(bins-1, max(0, math.ceil((value-low)/(high-low)*bins)-1))
            counts[index] += 1
        plotted = counts
        for i, value in enumerate(counts):
            height = value / max(counts) * 85
            rectangles.append((15+i*190/len(counts), 110-height, 190/len(counts), height))
    elif kind == 'funnel':
        for i, value in enumerate(normalized):
            rectangles.append((110-value*90, 15+i*95/len(values), value*180, 90/len(values)))
    elif kind == 'waterfall':
        cumulative = 0
        for i, value in enumerate(normalized):
            bottom = 110-cumulative/total*90
            cumulative += value
            top = 110-cumulative/total*90
            rectangles.append((15+i*190/len(values), top, 160/len(values), bottom-top))
    elif kind == 'treemap':
        cumulative = 0
        for value in normalized:
            rectangles.append((15+cumulative/total*190, 15, value/total*190, 95))
            cumulative += value
    else:
        raise ValueError(kind)
    assert all(math.isfinite(v) and v >= 0 for rect in rectangles for v in rect)
    return rectangles, plotted


def project(path, output):
    original = path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(original)) as z:
        parts = {n: z.read(n) for n in z.namelist()}
    slide_part = 'ppt/slides/slide1.xml'
    slide = E.fromstring(parts[slide_part])
    tree = slide.find(f'{{{P}}}cSld/{{{P}}}spTree')
    frame = next(n for n in tree if n.tag == f'{{{P}}}graphicFrame' and n.find(f'.//{{{CX}}}chart') is not None)
    ref = frame.find(f'.//{{{CX}}}chart').attrib[f'{{{R}}}id']
    rels = E.fromstring(parts['ppt/slides/_rels/slide1.xml.rels'])
    relation = next(n for n in rels if n.attrib['Id'] == ref)
    chart_part = posixpath.normpath(posixpath.join('ppt/slides', relation.attrib['Target']))
    chart = E.fromstring(parts[chart_part])
    series = chart.findall(f'.//{{{CX}}}series')
    assert len(series) == 1
    layout = series[0].attrib['layoutId']
    kind = 'histogram' if layout == 'clusteredColumn' else layout
    data_id = series[0].find(f'{{{CX}}}dataId').attrib['val']
    data = next(n for n in chart.findall(f'{{{CX}}}chartData/{{{CX}}}data') if n.attrib['id'] == data_id)
    dim = next(n for n in data if n.tag == f'{{{CX}}}numDim' and n.attrib['type'] in ['val', 'size'])
    level = dim.find(f'{{{CX}}}lvl')
    values = [float(n.text) for n in level]
    assert int(level.attrib['ptCount']) == len(values)
    assert [n.attrib['idx'] for n in level] == [str(i) for i in range(len(values))]
    # Independently check the fixture's embedded workbook, not just its cache.
    chart_rels = E.fromstring(parts[posixpath.join(posixpath.dirname(chart_part), '_rels', posixpath.basename(chart_part)+'.rels')])
    embedded_id = chart.find(f'{{{CX}}}chartData/{{{CX}}}externalData').attrib[f'{{{R}}}id']
    book_target = next(n.attrib['Target'] for n in chart_rels if n.attrib['Id'] == embedded_id)
    book_part = posixpath.normpath(posixpath.join(posixpath.dirname(chart_part), book_target))
    with zipfile.ZipFile(io.BytesIO(parts[book_part])) as book:
        sheet = E.fromstring(book.read('xl/worksheets/sheet1.xml'))
        numbers = {n.attrib['r']: float(n.find(f'{{{S}}}v').text) for n in sheet.iter(f'{{{S}}}c') if n.find(f'{{{S}}}v') is not None}
        assert [numbers[f'B{i+2}'] for i in range(len(values))] == values
    bins_node = series[0].find(f'{{{CX}}}layoutPr/{{{CX}}}binning/{{{CX}}}binCount')
    rectangles, plotted = geometry(kind, values, int(bins_node.text) if bins_node is not None else 1)
    ids = [int(n.attrib['id']) for n in slide.iter(f'{{{P}}}cNvPr')]
    next_id = max(ids)+1
    group = E.Element(f'{{{P}}}grpSp')
    nv = node(group, P, 'nvGrpSpPr')
    nv.append(frame.find(f'{{{P}}}nvGraphicFramePr/{{{P}}}cNvPr'))
    node(nv, P, 'cNvGrpSpPr'); node(nv, P, 'nvPr')
    prop = node(group, P, 'grpSpPr')
    transform = frame.find(f'{{{P}}}xfrm')
    tx = node(prop, A, 'xfrm', **transform.attrib)
    for item in transform:
        tx.append(item)
    node(tx, A, 'chOff', x=0, y=0); node(tx, A, 'chExt', cx=2200000, cy=1300000)
    for i, (x, y, width, height) in enumerate(rectangles):
        if width == 0 or height == 0:
            continue
        shape = node(group, P, 'sp'); nv = node(shape, P, 'nvSpPr')
        node(nv, P, 'cNvPr', id=next_id, name=f'{kind} value {i}'); next_id += 1
        node(nv, P, 'cNvSpPr'); node(nv, P, 'nvPr')
        prop = node(shape, P, 'spPr'); tx = node(prop, A, 'xfrm')
        node(tx, A, 'off', x=round(x*10000), y=round(y*10000)); node(tx, A, 'ext', cx=max(1,round(width*10000)), cy=max(1,round(height*10000)))
        node(node(prop, A, 'prstGeom', prst='rect'), A, 'avLst')
        node(node(prop, A, 'solidFill'), A, 'srgbClr', val=['14806E','C35B55','5779A8','B68538'][i%4])
        node(node(prop, A, 'ln'), A, 'noFill')
    tree.insert(list(tree).index(frame), group); tree.remove(frame)
    parts[slide_part] = E.tostring(slide, encoding='utf-8', xml_declaration=True)
    output.mkdir(parents=True, exist_ok=True)
    result = output/path.name
    with zipfile.ZipFile(result, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in parts.items():
            z.writestr(name, data)
    with zipfile.ZipFile(io.BytesIO(original)) as before, zipfile.ZipFile(result) as after:
        assert before.namelist() == after.namelist()
        assert all(before.read(n) == after.read(n) for n in before.namelist() if n != slide_part)
    assert path.read_bytes() == original
    return {'kind':kind,'values':values,'plotted':plotted,'rectangles':rectangles,'inputHash':hashlib.sha256(original).hexdigest(),'projectionHash':hashlib.sha256(result.read_bytes()).hexdigest(),'sourceAndDataPreserved':True,'changedParts':[slide_part], 'limits':'Geometry experiment only. Colors are prototype reference; title/labels/axes/legend/custom source styles not yet projected.'}


if __name__ == '__main__':
    source, output = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    results = [project(path, output) for path in sorted(source.glob('*.pptx'))]
    (output/'projection.json').write_text(json.dumps(results, indent=2)+'\n')
    print(json.dumps(results))
