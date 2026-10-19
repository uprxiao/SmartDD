"""Research only: a genuine area + marker-only line combination in synthetic PPTX.

Does not change product parsing, source fixtures, or the UI acceptance ledger.
Usage: python3 pptx-area-marker-probe.py single.pptx eight.pptx output-directory
"""
from pathlib import Path
import copy
import hashlib
import json
import posixpath
import sys
import xml.etree.ElementTree as E
import zipfile

C = "{http://schemas.openxmlformats.org/drawingml/2006/chart}"
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"


def relations(package, part):
    path = posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part) + ".rels")
    return {n.attrib["Id"]: posixpath.normpath(posixpath.join(posixpath.dirname(part), n.attrib["Target"])) for n in E.fromstring(package.read(path))}


def convert(source, destination):
    with zipfile.ZipFile(source) as package:
        main = E.fromstring(package.read("ppt/presentation.xml"))
        slides = relations(package, "ppt/presentation.xml")
        selected = []
        for page, node in enumerate(main.iter(P + "sldId"), 1):
            part = slides[node.attrib[R + "id"]]
            mapping = relations(package, part)
            for ref in E.fromstring(package.read(part)).iter(C + "chart"):
                chart_part = mapping[ref.attrib[R + "id"]]
                chart = E.fromstring(package.read(chart_part))
                plot = chart.find(C + "chart/" + C + "plotArea")
                area = plot.find(C + "areaChart")
                if area is not None:
                    selected.append((page, chart_part, chart, plot, area))
        assert len(selected) == 1, "Expected one live synthetic area chart"
        page, chart_part, chart, plot, area = selected[0]
        series = copy.deepcopy(area.find(C + "ser"))
        series.find(C + "idx").set("val", "1")
        series.find(C + "order").set("val", "1")
        prop = E.Element(C + "spPr")
        E.SubElement(E.SubElement(prop, A + "ln"), A + "noFill")
        series.insert(3, prop)
        marker = E.Element(C + "marker")
        E.SubElement(marker, C + "symbol", {"val": "none"})
        E.SubElement(marker, C + "size", {"val": "6"})
        series.insert(4, marker)
        for point in series.findall(C + "dPt"):
            mark = E.Element(C + "marker")
            E.SubElement(mark, C + "symbol", {"val": "circle"})
            E.SubElement(mark, C + "size", {"val": "6"})
            mark.append(copy.deepcopy(point.find(C + "spPr")))
            point.insert(1, mark)
        E.SubElement(series, C + "smooth", {"val": "0"})
        line = E.Element(C + "lineChart")
        E.SubElement(line, C + "grouping", {"val": "standard"})
        E.SubElement(line, C + "varyColors", {"val": "0"})
        line.append(series)
        for axis in area.findall(C + "axId"):
            line.append(copy.deepcopy(axis))
        plot.insert(list(plot).index(area) + 1, line)
        legend = chart.find(C + "chart/" + C + "legend")
        if legend is not None:
            hidden = E.Element(C + "legendEntry")
            E.SubElement(hidden, C + "idx", {"val": "1"})
            E.SubElement(hidden, C + "delete", {"val": "1"})
            legend.insert(1, hidden)
        payload = E.tostring(chart, encoding="utf-8", xml_declaration=True)
        with zipfile.ZipFile(destination, "w") as output:
            for info in package.infolist():
                output.writestr(copy.copy(info), payload if info.filename == chart_part else package.read(info.filename))
        with zipfile.ZipFile(destination) as output:
            assert all(output.read(n) == package.read(n) for n in package.namelist() if n != chart_part)
    return {"input": str(source), "output": str(destination), "page": page, "changedPart": chart_part, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(), "productionIntegrated": False}


if __name__ == "__main__":
    single, eight, directory = map(Path, sys.argv[1:])
    directory.mkdir(parents=True, exist_ok=True)
    results = [convert(single, directory / "single-area-combination.pptx"), convert(eight, directory / "eight-area-combination.pptx")]
    (directory / "fixtures.json").write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results))
