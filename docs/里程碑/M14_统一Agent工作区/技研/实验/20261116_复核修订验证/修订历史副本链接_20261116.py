#!/usr/bin/env python3
"""RV19：把 2026-11-16 复制进各 历史/ 目录的整稿副本中失效的相对链接改为按其原所在目录解析（补 ../）。
只改 document-audit.json 报告为 missing-path／missing-anchor、且按原目录解析能找到目标的链接；修改前全文存入 历史副本链接原件_20261116.json.gz（键为仓库相对路径），并在 results/history-link-fix.json 记录前后 SHA-256。"""
from pathlib import Path
import gzip, hashlib, json, re
from urllib.parse import unquote
here = Path(__file__).resolve().parent
repo = next(p for p in here.parents if (p / 'src/main/db/schema.ts').exists())
bad = json.loads((here / 'results/document-audit.json').read_text())['localLinkFailures']
by_doc = {}
for r in bad:
    if '/历史/' in r['document']: by_doc.setdefault(r['document'], set()).add(r['href'])
store = here / '历史副本链接原件_20261116.json.gz'
originals = json.loads(gzip.decompress(store.read_bytes())) if store.exists() else {}
report = []
for doc, hrefs in sorted(by_doc.items()):
    p = repo / doc; text = p.read_text(); before = text
    changed = 0; skipped = []
    def fix(m):
        global_changed = None
        label, url = m.group(1), m.group(2)
        u = url[1:-1] if url.startswith('<') else url
        if u not in hrefs: return m.group(0)
        name, sep, anchor = u.partition('#')
        if not name: return m.group(0)
        if (p.parent.parent / unquote(name)).resolve().exists():
            nonlocal_changed.append(1)
            return f'[{label}](../{name}{sep}{anchor})'
        skipped.append(u); return m.group(0)
    nonlocal_changed = []
    text = re.sub(r'(?<!!)\[([^\]]*)\]\((<[^>]+>|[^\s)]+)\)', fix, text)
    if text != before:
        originals.setdefault(doc, before)
        p.write_text(text)
    report.append({'document': doc, 'fixed': len(nonlocal_changed), 'skipped': sorted(set(skipped)),
                   'sha256Before': hashlib.sha256(before.encode()).hexdigest(), 'sha256After': hashlib.sha256(text.encode()).hexdigest()})
store.write_bytes(gzip.compress(json.dumps(originals, ensure_ascii=False).encode()))
(here / 'results/history-link-fix.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'documents': len(report), 'fixed': sum(r['fixed'] for r in report), 'skipped': sum(len(r['skipped']) for r in report)}, ensure_ascii=False))
