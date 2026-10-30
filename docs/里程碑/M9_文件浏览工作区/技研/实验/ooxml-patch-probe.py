#!/usr/bin/env python3
"""M9-GAP-04 隔离实验：OOXML 精确补丁（surgical patch）与 LibreOffice 整份重写的保真对比。

思路：编辑只改被编辑内容所在的那一个 XML 部件，且尽量在字节层做唯一匹配替换；其余 ZIP 部件的解压内容、顺序、名称逐字节保持。
对照组：同一批文件走 LibreOffice `--convert-to` 同格式重写，量化丢失/改写的部件。
样本全部由本脚本生成（python-docx / openpyxl / pandoc + 手工注入批注、修订、共享字符串、批注、未知部件、宏样部件），不读取用户文件。
判定：
  - untouchedIdentical：未被编辑的部件解压后 SHA-256 与原件相同，且条目顺序一致
  - editedOnly：被编辑部件的 c14n 与“期望变换”一致（文本替换后相等）
  - independentRead：python-docx / openpyxl / 标准 ZIP+XML 读回编辑内容
  - rendererAccepts：LibreOffice 能打开并导出 PDF，pdftotext 能找到新文本
status ∈ passed / observed-gap / failed。observed-gap 表示负对照复现了限制，不是通过。
"""
import argparse, hashlib, json, os, pathlib, re, shutil, subprocess, sys, tempfile, time, zipfile
from lxml import etree

HERE = pathlib.Path(__file__).resolve()
sha = lambda b: hashlib.sha256(b).hexdigest()
OPAQUE_NAME = 'customXml/m9-opaque.bin'
OPAQUE = bytes(range(256)) * 4
VBA_NAME_BY_EXT = {'docx': 'word/vbaProject.bin', 'xlsx': 'xl/vbaProject.bin', 'pptx': 'ppt/vbaProject.bin'}


def run(args, timeout=90):
    t = time.monotonic()
    try:
        p = subprocess.run([str(a) for a in args], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        return {'exitCode': p.returncode, 'ms': round((time.monotonic() - t) * 1000), 'stdout': p.stdout.decode('utf-8', 'replace').strip()[:2000], 'stderr': p.stderr.decode('utf-8', 'replace').strip()[:500]}
    except subprocess.TimeoutExpired:
        return {'exitCode': None, 'timeoutSeconds': timeout}


def read_zip(path):
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        return [(i.filename, z.read(i.filename)) for i in z.infolist()]


def write_zip(path, entries):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in entries:
            z.writestr(name, data)


def c14n(data):
    return etree.tostring(etree.fromstring(data), method='c14n')


def add_part(entries, name, data, content_type, rel_target_dir_rels=None, rel_type=None):
    """向包里加入未知部件并登记 Override；可选在指定 rels 中登记关系。"""
    d = dict(entries)
    d[name] = data
    ct = d['[Content_Types].xml']
    d['[Content_Types].xml'] = ct.replace(b'</Types>', ('<Override PartName="/%s" ContentType="%s"/></Types>' % (name, content_type)).encode())
    if rel_target_dir_rels:
        rels, target = rel_target_dir_rels
        d[rels] = d[rels].replace(b'</Relationships>', ('<Relationship Id="m9rel%d" Type="%s" Target="%s"/></Relationships>' % (len(d[rels]) % 9973, rel_type, target)).encode())
    return list(d.items()) if not isinstance(entries, list) else [(k, d[k]) for k, _ in entries] + [(k, v) for k, v in d.items() if k not in dict(entries)]


# ---------------- 样本生成 ----------------
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'


def make_docx(root):
    from docx import Document
    doc = Document()
    doc.add_heading('M9_DOC_TITLE', 0)
    doc.add_paragraph('普通段落 PLAIN_ONE 保持格式。')
    p = doc.add_paragraph(); p.add_run('跨 ').bold = True; p.add_run('SPLIT_').italic = True; p.add_run('RUN 两个格式不同的 run。')
    doc.add_paragraph('批注范围内 COMMENTED_TEXT 末尾。')
    doc.add_paragraph('修订段落：')
    t = doc.add_table(rows=1, cols=2); t.cell(0, 0).text = 'CELL_A'; t.cell(0, 1).text = '单元格'
    path = root / 'src.docx'; doc.save(path)
    entries = read_zip(path); d = dict(entries)
    body = d['word/document.xml'].decode('utf-8')
    # 批注范围
    body = body.replace('批注范围内 COMMENTED_TEXT 末尾。', '批注范围内 </w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>COMMENTED_TEXT</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:r><w:t xml:space="preserve"> 末尾。')
    # 修订：一段已接受前的插入与删除
    body = body.replace('修订段落：', '修订段落：</w:t></w:r><w:ins w:id="11" w:author="Reviewer A" w:date="2026-01-02T03:04:05Z"><w:r><w:t>TRACKED_INSERT</w:t></w:r></w:ins><w:del w:id="12" w:author="Reviewer B" w:date="2026-01-02T03:04:06Z"><w:r><w:delText>TRACKED_DELETE</w:delText></w:r></w:del><w:r><w:t xml:space="preserve">')
    d['word/document.xml'] = body.encode('utf-8')
    comments = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="%s"><w:comment w:id="0" w:author="Reviewer C" w:date="2026-01-02T03:04:07Z" w:initials="RC"><w:p><w:r><w:t>COMMENT_BODY</w:t></w:r></w:p></w:comment></w:comments>' % W).encode()
    d['word/comments.xml'] = comments
    d['[Content_Types].xml'] = d['[Content_Types].xml'].replace(b'</Types>', b'<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>')
    d['word/_rels/document.xml.rels'] = d['word/_rels/document.xml.rels'].replace(b'</Relationships>', b'<Relationship Id="rIdM9c" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>')
    out = [(k, d[k]) for k, _ in entries] + [(k, v) for k, v in d.items() if k not in dict(entries)]
    out = add_part(out, OPAQUE_NAME, OPAQUE, 'application/octet-stream', ('_rels/.rels', OPAQUE_NAME), 'urn:smartdd:m9:opaque')
    out = add_part(out, VBA_NAME_BY_EXT['docx'], b'VBA-PLACEHOLDER-NOT-EXECUTED' * 8, 'application/vnd.ms-office.vbaProject')
    final = root / 'fixture.docx'; write_zip(final, out); return final


def make_xlsx(root):
    from openpyxl import Workbook
    from openpyxl.styles import Font
    wb = Workbook(); ws = wb.active; ws.title = 'Data'
    ws['A1'] = 'UNIQUE_LABEL'; ws['A2'] = 'SHARED_TEXT'; ws['A3'] = 'SHARED_TEXT'; ws['B1'] = 3; ws['B2'] = 4; ws['C1'] = '=SUM(B1:B2)'
    ws['A1'].font = Font(bold=True, color='FF0000'); ws['B1'].number_format = '0.00'
    ws2 = wb.create_sheet('Second'); ws2['A1'] = 'SECOND_SHEET'
    path = root / 'src.xlsx'; wb.save(path)
    # 新版 openpyxl 写内联字符串；真实 Excel 用共享字符串表。这里转换成 sharedStrings 以匹配真实文件，并补入公式缓存 <v>7</v>
    entries = read_zip(path); d = dict(entries)
    strings = []
    def to_shared(m):
        text = m.group(3)
        if text not in strings: strings.append(text)
        return '<c r="%s"%s t="s"><v>%d</v></c>' % (m.group(1), m.group(2), strings.index(text))
    for name in [n for n in d if re.match(r'xl/worksheets/sheet\d+\.xml$', n)]:
        d[name] = re.sub(r'<c r="([A-Z]+\d+)"([^>]*?) t="inlineStr"><is><t[^>]*>(.*?)</t></is></c>', to_shared, d[name].decode()).encode()
    d['xl/sharedStrings.xml'] = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="%d" uniqueCount="%d">%s</sst>' % (len(strings) + 1, len(strings), ''.join('<si><t>%s</t></si>' % t for t in strings))).encode()
    d['[Content_Types].xml'] = d['[Content_Types].xml'].replace(b'</Types>', b'<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>')
    d['xl/_rels/workbook.xml.rels'] = d['xl/_rels/workbook.xml.rels'].replace(b'</Relationships>', b'<Relationship Id="rIdM9s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>')
    entries = [(k, d[k]) for k, _ in entries] + [('xl/sharedStrings.xml', d['xl/sharedStrings.xml'])]
    sheet = d['xl/worksheets/sheet1.xml'].decode()
    m = re.search(r'<c r="C1"[^>]*>\s*<f>SUM\(B1:B2\)</f>\s*<v\s*/>|<c r="C1"[^>]*><f>SUM\(B1:B2\)</f><v></v>|<c r="C1"[^>]*><f>SUM\(B1:B2\)</f>', sheet)
    assert m, sheet[:600]
    cell = m.group(0)
    new = re.sub(r'<v\s*/>|<v></v>', '', cell) + '<v>7</v>'
    sheet = sheet.replace(cell, new, 1); d['xl/worksheets/sheet1.xml'] = sheet.encode()
    out = [(k, d[k]) for k, _ in entries]
    out = add_part(out, OPAQUE_NAME, OPAQUE, 'application/octet-stream', ('_rels/.rels', OPAQUE_NAME), 'urn:smartdd:m9:opaque')
    out = add_part(out, VBA_NAME_BY_EXT['xlsx'], b'VBA-PLACEHOLDER-NOT-EXECUTED' * 8, 'application/vnd.ms-office.vbaProject')
    final = root / 'fixture.xlsx'; write_zip(final, out); return final


def make_pptx(root):
    md = root / 'slides.md'
    md.write_text('# PPT_TITLE_ONE\n\n- 要点 BULLET_ONE\n\n::: notes\nNOTES_TEXT\n:::\n\n# PPT_TITLE_TWO\n\n正文 BODY_TWO\n', encoding='utf-8')
    src = root / 'src.pptx'
    r = run(['pandoc', md, '--slide-level=1', '-t', 'pptx', '-o', src])
    if r['exitCode'] != 0: raise RuntimeError(r)
    out = read_zip(src)
    out = add_part(out, OPAQUE_NAME, OPAQUE, 'application/octet-stream', ('_rels/.rels', OPAQUE_NAME), 'urn:smartdd:m9:opaque')
    out = add_part(out, VBA_NAME_BY_EXT['pptx'], b'VBA-PLACEHOLDER-NOT-EXECUTED' * 8, 'application/vnd.ms-office.vbaProject')
    final = root / 'fixture.pptx'; write_zip(final, out); return final


# ---------------- 精确补丁 ----------------
class PatchRefused(Exception):
    pass


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def patch_bytes(entries, part, old, new):
    """在指定部件里做唯一的字节级文本替换；匹配不唯一/不存在则拒绝（安全失败）。"""
    out = []; hit = 0
    for name, data in entries:
        if name == part:
            n = data.count(esc(old).encode('utf-8'))
            if n != 1: raise PatchRefused('%s: "%s" 匹配 %d 次，拒绝补丁' % (part, old, n))
            data = data.replace(esc(old).encode('utf-8'), esc(new).encode('utf-8')); hit = 1
        out.append((name, data))
    if not hit: raise PatchRefused('部件不存在：' + part)
    return out


def replace_part(entries, part, fn):
    return [(n, fn(d) if n == part else d) for n, d in entries]


def patch_docx_split_run(data):
    """跨 run 编辑：新文本放入第一个 run，其余被覆盖的 run 的 w:t 置空，保留各自的 rPr。"""
    root = etree.fromstring(data); ns = {'w': W}
    for p in root.iterfind('.//w:p', ns):
        runs = p.findall('w:r', ns); texts = [''.join(r.itertext()) for r in runs]
        joined = ''.join(texts)
        if 'SPLIT_RUN' in joined:
            ts = [r.find('w:t', ns) for r in runs]
            i1 = next(i for i, r in enumerate(runs) if 'SPLIT_' in texts[i]); i2 = i1 + 1
            assert ts[i1].text == 'SPLIT_' and ts[i2].text == 'RUN 两个格式不同的 run。', (ts[i1].text, ts[i2].text)
            ts[i1].text = 'MERGED_NEW'; ts[i2].text = ' 已编辑的剩余文字。'
            return etree.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
    raise PatchRefused('未找到跨 run 段落')



def shared_string_refs(entries, text):
    """返回 (索引, 所有工作表中引用该索引的单元格数)。字符串表中的唯一性不等于单元格引用唯一。"""
    d = dict(entries); sst = d['xl/sharedStrings.xml'].decode()
    sis = re.findall(r'<si>.*?</si>', sst, re.S)
    idx = next(i for i, x in enumerate(sis) if esc(text) in x)
    refs = 0
    for n, v in entries:
        if re.match(r'xl/worksheets/sheet\d+\.xml$', n):
            refs += len(re.findall(r'<c [^>]*t="s"[^>]*>\s*<v>%d</v>' % idx, v.decode()))
    return idx, refs


def safe_patch_shared_string(entries, text, new):
    """仅当引用数为 1 时才做字节级替换，否则拒绝（调用方改用追加新串）。"""
    idx, refs = shared_string_refs(entries, text)
    if refs != 1: raise PatchRefused('共享字符串被 %d 个单元格引用，字节级替换会同时修改它们，拒绝' % refs)
    return patch_bytes(entries, 'xl/sharedStrings.xml', text, new)

def patch_xlsx_shared_string_one_cell(entries):
    """共享字符串被两个单元格使用：只改 A3 → 追加新 <si>，A3 指向新索引；不改 A2。"""
    d = dict(entries)
    sst = d['xl/sharedStrings.xml'].decode(); sheet = d['xl/worksheets/sheet1.xml'].decode()
    sis = re.findall(r'<si>.*?</si>', sst, re.S)
    idx = next(i for i, s in enumerate(sis) if 'SHARED_TEXT' in s)
    new_idx = len(sis)
    m = re.search(r'<c r="A3"([^>]*) t="s"[^>]*><v>%d</v></c>|<c r="A3"([^>]*)><v>%d</v></c>' % (idx, idx), sheet)
    if not re.search(r'<c r="A3"[^>]*>\s*<v>%d</v>' % idx, sheet): raise PatchRefused('A3 未引用共享串 %d' % idx)
    sheet2 = re.sub(r'(<c r="A3"[^>]*>\s*<v>)%d(</v>)' % idx, r'\g<1>%d\2' % new_idx, sheet, count=1)
    sst2 = sst.replace('</sst>', '<si><t>A3_NEW</t></si></sst>')
    sst2 = re.sub(r'uniqueCount="(\d+)"', lambda m: 'uniqueCount="%d"' % (int(m.group(1)) + 1), sst2, count=1)
    sst2 = re.sub(r' count="(\d+)"', lambda m: ' count="%s"' % m.group(1), sst2, count=1)
    d['xl/sharedStrings.xml'] = sst2.encode(); d['xl/worksheets/sheet1.xml'] = sheet2.encode()
    return [(k, d[k]) for k, _ in entries]


def patch_xlsx_input_number(entries):
    """改输入单元格 B1=3→10：移除依赖公式 C1 的缓存值并在 workbook.xml 设置 fullCalcOnLoad，让读取方重算。"""
    d = dict(entries); sheet = d['xl/worksheets/sheet1.xml'].decode(); wb = d['xl/workbook.xml'].decode()
    sheet, n1 = re.subn(r'(<c r="B1"[^>]*><v>)3(</v></c>)', r'\g<1>10\2', sheet, count=1)
    if n1 != 1: raise PatchRefused('B1 不是预期的数值单元格')
    sheet, n2 = re.subn(r'(<c r="C1"[^>]*><f>SUM\(B1:B2\)</f>)<v>7</v>', r'\1', sheet, count=1)
    if n2 != 1: raise PatchRefused('C1 缓存值不是预期')
    if '<calcPr' in wb: wb = re.sub(r'<calcPr([^>]*?)/>', lambda m: '<calcPr' + re.sub(r' fullCalcOnLoad="[^"]*"', '', m.group(1)) + ' fullCalcOnLoad="1"/>', wb, count=1)
    else: wb = wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>')
    d['xl/worksheets/sheet1.xml'] = sheet.encode(); d['xl/workbook.xml'] = wb.encode()
    return [(k, d[k]) for k, _ in entries]


# ---------------- 度量 ----------------
def compare_packages(before, after, edited_parts):
    b = dict(before); a = dict(after)
    order_same = [n for n, _ in before] == [n for n, _ in after]
    untouched = [n for n in b if n not in edited_parts]
    changed_untouched = [n for n in untouched if n not in a or a[n] != b[n]]
    return {'orderSame': order_same, 'partCountBefore': len(b), 'partCountAfter': len(a), 'untouchedParts': len(untouched), 'untouchedChanged': changed_untouched,
            'missingParts': sorted(set(b) - set(a)), 'newParts': sorted(set(a) - set(b)),
            'opaquePreserved': a.get(OPAQUE_NAME) == OPAQUE, 'vbaPlaceholderPreserved': any(k.endswith('vbaProject.bin') and a[k].startswith(b'VBA-PLACEHOLDER') for k in a)}


def soffice_pdf(soffice, path, workdir):
    profile = workdir / ('profile-' + path.stem + '-' + path.suffix[1:]); out = workdir / ('pdf-' + path.stem + path.suffix[1:]); out.mkdir(exist_ok=True)
    r = run([soffice, '-env:UserInstallation=' + profile.as_uri(), '--headless', '--nologo', '--nodefault', '--norestore', '--convert-to', 'pdf', '--outdir', out, path])
    pdf = out / (path.stem + '.pdf')
    text = ''
    if pdf.exists():
        t = run(['pdftotext', pdf, '-']); text = t.get('stdout', '')
    return {'convert': {k: v for k, v in r.items() if k in ('exitCode', 'ms', 'stderr')}, 'pdfExists': pdf.exists(), 'text': text}


def libreoffice_roundtrip(soffice, path, fmt, workdir):
    out = workdir / ('lo-' + path.suffix[1:]); out.mkdir(exist_ok=True)
    profile = workdir / ('lo-profile-' + path.suffix[1:])
    r = run([soffice, '-env:UserInstallation=' + profile.as_uri(), '--headless', '--nologo', '--nodefault', '--norestore', '--convert-to', fmt, '--outdir', out, path])
    res = out / path.name
    return res if res.exists() else None, r


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--output', required=True); args = ap.parse_args()
    soffice = shutil.which('soffice') or '/Applications/LibreOffice.app/Contents/MacOS/soffice'
    for t in (soffice, shutil.which('pandoc'), shutil.which('pdftotext')):
        if not t or not os.path.exists(t): raise RuntimeError('缺少已有工具：%s（脚本不安装软件）' % t)
    from docx import Document
    import openpyxl
    cases = []
    def case(cid, title, fn):
        t = time.monotonic()
        try: status, ev = fn()
        except PatchRefused as e: status, ev = 'refused', {'reason': str(e)}
        except Exception as e: status, ev = 'failed', {'exception': repr(e)}
        cases.append({'id': cid, 'title': title, 'status': status, 'ms': round((time.monotonic() - t) * 1000), 'evidence': ev})

    with tempfile.TemporaryDirectory(prefix='m9-ooxml-patch-') as tmp:
        root = pathlib.Path(tmp)
        docx = make_docx(root); xlsx = make_xlsx(root); pptx = make_pptx(root)
        fx = {'docx': read_zip(docx), 'xlsx': read_zip(xlsx), 'pptx': read_zip(pptx)}
        base_render = {e: soffice_pdf(soffice, p, root) for e, p in (('docx', docx), ('xlsx', xlsx), ('pptx', pptx))}

        def finish(ext, name, edits, edited_parts, expect_text, extra=None):
            """edits: 新 entries。写出、对比、独立读回、渲染器检查。"""
            out = root / ('patched-%s.%s' % (name, ext)); write_zip(out, edits)
            cmp_ = compare_packages(fx[ext], edits, edited_parts)
            render = soffice_pdf(soffice, out, root)
            ev = {'package': cmp_, 'rendererAccepts': render['pdfExists'] and all(t in render['text'] for t in expect_text),
                  'renderedTextFound': {t: (t in render['text']) for t in expect_text}, 'libreofficeExit': render['convert']}
            if extra: ev.update(extra(out))
            ok = (cmp_['orderSame'] and not cmp_['untouchedChanged'] and not cmp_['missingParts'] and not cmp_['newParts'] and cmp_['opaquePreserved'] and cmp_['vbaPlaceholderPreserved'] and ev['rendererAccepts'])
            return ('passed' if ok else 'failed'), ev

        # ---- DOCX ----
        def d_read(path):
            doc = Document(path); texts = [p.text for p in doc.paragraphs]
            return {'paragraphs': texts, 'tableCell': doc.tables[0].cell(0, 0).text}
        def d1():
            e = patch_bytes(fx['docx'], 'word/document.xml', 'PLAIN_ONE', 'PLAIN_EDITED')
            ev = finish('docx', 'd1', e, {'word/document.xml'}, ['PLAIN_EDITED'], lambda p: {'independentRead': d_read(p)})
            old = c14n(dict(fx['docx'])['word/document.xml']).replace(b'PLAIN_ONE', b'PLAIN_EDITED')
            ev[1]['editedOnlyTextChange'] = c14n(dict(e)['word/document.xml']) == old
            return (ev[0] if ev[1]['editedOnlyTextChange'] else 'failed'), ev[1]
        case('OP01', 'DOCX 普通 run 文本：字节级唯一替换，其余部件逐字节不变', d1)

        def d2():
            e = patch_bytes(fx['docx'], 'word/document.xml', 'TRACKED_INSERT', 'TRACKED_INSERT_EDITED')
            r = finish('docx', 'd2', e, {'word/document.xml'}, ['TRACKED_INSERT_EDITED'], lambda p: {'independentRead': d_read(p)})
            xml = dict(e)['word/document.xml'].decode()
            r[1]['trackedChangeMetadata'] = {'insAuthorKept': 'w:author="Reviewer A"' in xml and 'w:date="2026-01-02T03:04:05Z"' in xml, 'delKept': 'TRACKED_DELETE' in xml and 'Reviewer B' in xml}
            return (r[0] if all(r[1]['trackedChangeMetadata'].values()) else 'failed'), r[1]
        case('OP02', 'DOCX 修订内文本：作者/时间/删除记录保留', d2)

        def d3():
            e = patch_bytes(fx['docx'], 'word/document.xml', 'COMMENTED_TEXT', 'COMMENTED_EDITED')
            r = finish('docx', 'd3', e, {'word/document.xml'}, ['COMMENTED_EDITED'])
            xml = dict(e)['word/document.xml'].decode()
            r[1]['commentAnchorKept'] = all(s in xml for s in ('commentRangeStart w:id="0"', 'commentRangeEnd w:id="0"', 'commentReference w:id="0"')) and dict(e)['word/comments.xml'] == dict(fx['docx'])['word/comments.xml']
            return (r[0] if r[1]['commentAnchorKept'] else 'failed'), r[1]
        case('OP03', 'DOCX 批注范围内文本：批注锚点与 comments.xml 不变', d3)

        def d4():
            try:
                patch_bytes(fx['docx'], 'word/document.xml', 'SPLIT_RUN', 'X')
            except PatchRefused as e:
                refused = str(e)
            else: refused = None
            e = replace_part(fx['docx'], 'word/document.xml', patch_docx_split_run)
            r = finish('docx', 'd4', e, {'word/document.xml'}, ['MERGED_NEW'], lambda p: {'independentRead': d_read(p)})
            xml = dict(e)['word/document.xml'].decode()
            r[1]['byteLevelRefusedAcrossRuns'] = refused
            r[1]['formattingKept'] = {'boldRunStillBold': '<w:b/>' in xml, 'italicRunStillItalic': '<w:i/>' in xml}
            ok = refused is not None and all(r[1]['formattingKept'].values())
            return (r[0] if ok else 'failed'), r[1]
        case('OP04', 'DOCX 跨 run 编辑：字节级补丁安全拒绝；结构化补丁保留两个 run 的格式', d4)

        def d5():
            e = patch_bytes(fx['docx'], 'word/document.xml', 'CELL_A', 'CELL_EDITED')
            return finish('docx', 'd5', e, {'word/document.xml'}, ['CELL_EDITED'], lambda p: {'independentRead': d_read(p)})
        case('OP05', 'DOCX 表格单元格文本', d5)

        # ---- XLSX ----
        def x_read(path):
            wb = openpyxl.load_workbook(path); v = openpyxl.load_workbook(path, data_only=True)
            ws = wb['Data']; vs = v['Data']
            return {'sheets': wb.sheetnames, 'A1': ws['A1'].value, 'A2': ws['A2'].value, 'A3': ws['A3'].value, 'B1': ws['B1'].value, 'C1_formula': ws['C1'].value, 'C1_cached': vs['C1'].value, 'A1_bold': ws['A1'].font.b, 'B1_format': ws['B1'].number_format}
        def x1():
            e = safe_patch_shared_string(fx['xlsx'], 'UNIQUE_LABEL', 'U_NEW')
            r = finish('xlsx', 'x1', e, {'xl/sharedStrings.xml'}, ['U_NEW'], lambda p: {'independentRead': x_read(p)})
            r[1]['styleKept'] = r[1]['independentRead']['A1_bold'] is True
            return (r[0] if r[1]['styleKept'] else 'failed'), r[1]
        case('OP06', 'XLSX 仅被一个单元格引用的共享字符串：字节级替换，样式不变', x1)

        def x2():
            # 危险演示：朴素字节替换在字符串表里“唯一匹配”，却同时改了 A2 和 A3
            naive = patch_bytes(fx['xlsx'], 'xl/sharedStrings.xml', 'SHARED_TEXT', 'BOTH_X')
            nv = root / 'naive.xlsx'; write_zip(nv, naive); naive_read = x_read(nv)
            try: safe_patch_shared_string(fx['xlsx'], 'SHARED_TEXT', 'X'); guard = None
            except PatchRefused as e: guard = str(e)
            e = patch_xlsx_shared_string_one_cell(fx['xlsx'])
            r = finish('xlsx', 'x2', e, {'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml'}, ['A3_NEW', 'SHARED_T'], lambda p: {'independentRead': x_read(p)})
            ir = r[1]['independentRead']
            r[1]['naiveByteReplaceHazard'] = {'A2': naive_read['A2'], 'A3': naive_read['A3'], 'bothChanged': naive_read['A2'] == naive_read['A3'] == 'BOTH_X'}
            r[1]['referenceCountGuard'] = guard
            ok = r[1]['naiveByteReplaceHazard']['bothChanged'] and guard is not None and ir['A2'] == 'SHARED_TEXT' and ir['A3'] == 'A3_NEW'
            return (r[0] if ok else 'failed'), r[1]
        case('OP07', 'XLSX 被两个单元格共享的字符串：朴素字节替换会同时改两处（危险已演示）；引用计数拒绝；追加新串只改 A3', x2)

        def x3():
            e = patch_xlsx_input_number(fx['xlsx'])
            r = finish('xlsx', 'x3', e, {'xl/worksheets/sheet1.xml', 'xl/workbook.xml'}, ['14'], lambda p: {'independentRead': x_read(p)})
            ir = r[1]['independentRead']
            r[1]['staleCacheHandling'] = {'cachedValueRemoved': ir['C1_cached'] is None, 'fullCalcOnLoadSet': 'fullCalcOnLoad="1"' in dict(e)['xl/workbook.xml'].decode(), 'rendererRecalculatedTo14': r[1]['renderedTextFound'].get('14')}
            r[1]['limits'] = 'data_only 读取方（如 openpyxl、预览器）在重算前看到空值；不改缓存会让它们显示旧结果 7'
            ok = ir['B1'] == 10 and all(r[1]['staleCacheHandling'].values())
            return (r[0] if ok else 'failed'), r[1]
        case('OP08', 'XLSX 改输入数值：删除依赖公式的旧缓存并要求打开时重算，渲染器得到 14', x3)

        # ---- PPTX ----
        def p_text(path):
            z = dict(read_zip(path)); return {n: ''.join(etree.fromstring(v).itertext()) for n, v in z.items() if re.match(r'ppt/(slides|notesSlides)/[^/]+\.xml$', n)}
        def p1():
            e = patch_bytes(fx['pptx'], [n for n, d in fx['pptx'] if n.startswith('ppt/slides/slide') and b'BODY_TWO' in d][0], 'BODY_TWO', 'BODY_EDITED')
            part = [n for n, d in fx['pptx'] if n.startswith('ppt/slides/slide') and b'BODY_TWO' in d][0]
            return finish('pptx', 'p1', e, {part}, ['BODY_EDITED'], lambda p: {'independentRead': {k: v[:60] for k, v in p_text(p).items()}})
        case('OP09', 'PPTX 幻灯片文本：字节级替换，其余部件（含主版/布局/媒体）不变', p1)

        def p2():
            part = [n for n, d in fx['pptx'] if n.startswith('ppt/notesSlides/') and b'NOTES_TEXT' in d]
            if not part: raise PatchRefused('样本没有备注页（pandoc 版本差异）')
            e = patch_bytes(fx['pptx'], part[0], 'NOTES_TEXT', 'NOTES_EDITED')
            return finish('pptx', 'p2', e, {part[0]}, [], lambda p: {'notesRead': any('NOTES_EDITED' in v for v in p_text(p).values())})
        case('OP10', 'PPTX 备注文本', p2)

        # ---- 对照组：LibreOffice 整份重写 ----
        for ext, fmt, src, marker in (('docx', 'docx:Office Open XML Text', docx, 'PLAIN_ONE'), ('xlsx', 'xlsx:Calc MS Excel 2007 XML', xlsx, 'UNIQUE_LABEL'), ('pptx', 'pptx:Impress MS PowerPoint 2007 XML', pptx, 'BODY_TWO')):
            def ctl(ext=ext, fmt=fmt, src=src):
                res, r = libreoffice_roundtrip(soffice, src, fmt, root)
                if not res: return 'failed', {'convert': r}
                after = read_zip(res); cmp_ = compare_packages(fx[ext], after, set())
                lost = {'missingParts': cmp_['missingParts'], 'missingCount': len(cmp_['missingParts']), 'opaqueDropped': not cmp_['opaquePreserved'], 'vbaPlaceholderDropped': not cmp_['vbaPlaceholderPreserved'],
                        'partsRewrittenOrRenamed': len([n for n in dict(after) if n not in dict(fx[ext])]), 'partCountBefore': cmp_['partCountBefore'], 'partCountAfter': cmp_['partCountAfter']}
                if ext == 'docx':
                    xml = dict(after)['word/document.xml'].decode(); bx = dict(after)
                    lost['trackedChangesKept'] = 'TRACKED_INSERT' in xml and 'Reviewer A' in xml
                    lost['commentsKept'] = any('COMMENT_BODY' in v.decode('utf-8', 'ignore') for k, v in after if k.endswith('comments.xml'))
                gap = lost['opaqueDropped'] or lost['vbaPlaceholderDropped'] or lost['missingCount'] > 0
                return ('observed-gap' if gap else 'passed'), lost
            case('CT-' + ext.upper(), '对照：%s 经 LibreOffice 整份重写（未编辑）后的部件保真' % ext.upper(), ctl)
        root_cleanup = True
    report = {'schemaVersion': 1, 'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'scriptSha256': sha(HERE.read_bytes()),
              'environment': {'python': sys.version.split()[0], 'platform': sys.platform, 'soffice': run([soffice, '--version']).get('stdout'), 'pandoc': run(['pandoc', '--version']).get('stdout', '').split('\n')[0]},
              'scope': '合成 OOXML；精确补丁原型；不读取用户文件；宏样部件只是不执行的占位字节；渲染只验证 LibreOffice 能打开并出文本，不做版式像素比对',
              'cases': cases, 'completedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    summary = {}
    for c in cases: summary[c['status']] = summary.get(c['status'], 0) + 1
    report['summary'] = summary
    pathlib.Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False))
    for c in cases: print(c['id'], c['status'], c['title'])
    return 1 if summary.get('failed') else 0


if __name__ == '__main__':
    sys.exit(main())
