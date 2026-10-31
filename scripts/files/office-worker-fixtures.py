"""W26: owned complex OOXML plus valid ZIPs with actually malformed core XML."""
from pathlib import Path
import datetime, hashlib, json, shutil, subprocess, sys, tempfile, zipfile

base = Path(tempfile.mkdtemp(prefix='willyou-office-worker-fixtures-', dir='/private/tmp'))
project = base / 'project'
project.mkdir()
docx = json.loads(subprocess.check_output([sys.executable, 'scripts/files/docx-preview-fixtures.py'], text=True))
sources = {
    'docx': Path(docx['project']) / 'revisions.docx',
    'xlsx': Path('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'),
    'pptx': Path('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.pptx'),
}
parts = {'docx': 'word/document.xml', 'xlsx': 'xl/workbook.xml', 'pptx': 'ppt/presentation.xml'}
cases = []
for kind, source in sources.items():
    normal, corrupt = project / ('complex.' + kind), project / ('corrupt.' + kind)
    shutil.copy2(source, normal)
    with zipfile.ZipFile(source) as original, zipfile.ZipFile(corrupt, 'w') as output:
        for entry in original.infolist():
            output.writestr(entry, b'<intentionally-broken' if entry.filename == parts[kind] else original.read(entry))
    with zipfile.ZipFile(normal) as original, zipfile.ZipFile(corrupt) as broken:
        assert original.namelist() == broken.namelist()
        assert [n for n in original.namelist() if original.read(n) != broken.read(n)] == [parts[kind]]
    cases.append({'kind': kind, 'source': str(normal), 'sourceSha256': hashlib.sha256(normal.read_bytes()).hexdigest(), 'corrupt': str(corrupt), 'corruptSha256': hashlib.sha256(corrupt.read_bytes()).hexdigest(), 'corruptPart': parts[kind], 'bytes': normal.stat().st_size})
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'base': str(base), 'project': str(project), 'cases': cases, 'docxFixture': docx, 'boundary': 'Generated complex private sources. Corrupt variants retain valid ZIP ordering/entries, only core XML malformed; no user file or runtime package change.'}
(base / 'fixtures.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False))
