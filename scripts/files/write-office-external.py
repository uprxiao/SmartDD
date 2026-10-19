"""Independent test-only XLSX A1 writer; same inode, fsync, unrelated ZIP parts preserved."""
import hashlib, io, json, os, sys, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

path = Path(sys.argv[1]).resolve()
assert str(path).startswith('/private/tmp/willyou-'), 'Own synthetic fixture only'
text = sys.argv[2]
original = path.read_bytes()
before = path.stat()
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(io.BytesIO(original)) as source:
    parts = {info.filename: source.read(info) for info in source.infolist()}
    root = ET.fromstring(parts['xl/worksheets/sheet1.xml'])
    cell = root.find('.//s:c[@r="A1"]', ns)
    assert cell is not None and cell.find('s:f', ns) is None
    for node in list(cell):
        if node.tag in [f'{{{ns["s"]}}}{name}' for name in ['is', 'v']]:
            cell.remove(node)
    cell.set('t', 'inlineStr')
    value = ET.SubElement(ET.SubElement(cell, f'{{{ns["s"]}}}is'), f'{{{ns["s"]}}}t')
    value.text = text
    value.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
    parts['xl/worksheets/sheet1.xml'] = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    target = io.BytesIO()
    with zipfile.ZipFile(target, 'w') as output:
        for info in source.infolist():
            output.writestr(info, parts[info.filename])
content = target.getvalue()
with path.open('r+b') as stream:
    stream.write(content)
    stream.truncate()
    stream.flush()
    os.fsync(stream.fileno())
after = path.stat()
assert (before.st_dev, before.st_ino) == (after.st_dev, after.st_ino)
sha = lambda data: hashlib.sha256(data).hexdigest()
print(json.dumps({'path': str(path), 'text': text, 'beforeSha256': sha(original), 'afterSha256': sha(content), 'device': after.st_dev, 'inode': after.st_ino, 'beforeModifiedNs': before.st_mtime_ns, 'afterModifiedNs': after.st_mtime_ns, 'sameInode': True, 'otherPartsPreserved': True}))
