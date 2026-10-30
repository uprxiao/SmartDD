#!/usr/bin/env python3
"""Read a bounded private Foxmail sample; emit format statistics only.

No row values, source account/path, message bytes, subjects, bodies or attachments
are returned or written. The script never copies or changes the source files.
"""
from __future__ import annotations

import collections
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3

ROOT = Path('/Users/liubu/Library/Containers/com.tencent.Foxmail/Data/Library/Foxmail')
OUTPUT = Path(__file__).with_name('private-format-report.json')
MAX_SAMPLES = 3
MAX_BYTES = 65536


def entropy(data: bytes) -> float:
    if not data:
        return 0.0
    return round(-sum((n / len(data)) * math.log2(n / len(data)) for n in collections.Counter(data).values()), 3)


def stamp(p: Path) -> tuple[int, int, int, int]:
    s = p.stat()
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)


def main() -> None:
    report = {'schema': 'm10-foxmail-private-format-v1', 'at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'source_root': str(ROOT), 'source_account_names': 'omitted', 'data_values_queried': False,
              'sample_bytes_saved': False, 'max_samples': MAX_SAMPLES, 'max_bytes_each': MAX_BYTES,
              'profiles_examined': 0, 'database_schemas': [], 'samples': [],
              'limits': ['Only schemas and bounded byte-layout statistics; no content parsing or user-data export.',
                         'Results do not validate MIME decoding, source ID mapping, completeness or live synchronization.']}
    samples: list[Path] = []
    for profile in sorted((ROOT / 'Profiles').iterdir()):
        if not profile.is_dir() or profile.is_symlink():
            continue
        report['profiles_examined'] += 1
        db = profile / 'messages.db'
        if db.is_file():
            c = None
            entry = {'source': 'Profiles/<account>/messages.db', 'tables': [], 'error': None}
            try:
                c = sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, timeout=1)
                c.execute('PRAGMA query_only=ON')
                for table in ['mailinfo', 'boxes', 'mail_box_info', 'attachmentinfo', 'body_structure']:
                    columns = c.execute('PRAGMA table_info("' + table + '")').fetchall()
                    entry['tables'].append({'name': table, 'columns': [{'name': x[1], 'type': x[2]} for x in columns]})
                try:
                    c.execute('PRAGMA table_info("mail_fts")').fetchall()
                    entry['fts_schema_status'] = 'readable'
                except sqlite3.Error as e:
                    entry['fts_schema_status'] = type(e).__name__ + ': ' + str(e)
            except sqlite3.Error as e:
                entry['error'] = type(e).__name__ + ': ' + str(e)
            finally:
                if c:
                    c.close()
            report['database_schemas'].append(entry)
        for here, dirs, files in os.walk(profile / 'Mail', followlinks=False):
            dirs[:] = sorted(d for d in dirs if not (Path(here) / d).is_symlink())
            for name in sorted(files):
                p = Path(here) / name
                if p.suffix == '.mail' and not p.is_symlink():
                    samples.append(p)
                    if len(samples) == MAX_SAMPLES:
                        break
            if len(samples) == MAX_SAMPLES:
                break
        if len(samples) == MAX_SAMPLES:
            break
    for i, p in enumerate(samples, 1):
        before = stamp(p)
        with p.open('rb') as f:
            data = f.read(MAX_BYTES)
        after = stamp(p)
        header_names = ['From', 'To', 'Date', 'Subject', 'MIME-Version', 'Content-Type', 'Message-ID', 'Return-Path', 'Received']
        offsets = {}
        for name in header_names:
            m = re.search(rb'(?m)^' + re.escape(name.encode()) + rb':', data, re.I)
            if m:
                offsets[name] = m.start()
        first = data[:64]
        matches = {name: data.startswith(magic) for name, magic in {'sqlite': b'SQLite format 3\0', 'zip': b'PK\x03\x04', 'gzip': b'\x1f\x8b', 'zlib': b'\x78\x9c', 'mbox_From_separator': b'From '}.items()}
        report['samples'].append({'sample': i, 'extension': '.mail', 'file_bytes': before[2], 'examined_prefix_bytes': len(data),
            'source_stable_during_read': before == after, 'format_magic_matches': matches,
            'first_64_bytes_entropy': entropy(first), 'first_64_nul_count': first.count(0),
            'first_64_printable_ratio': round(sum(32 <= x < 127 or x in (9, 10, 13) for x in first) / max(1, len(first)), 3),
            'known_mime_header_name_offsets': offsets,
            'first_crlf_header_separator_offset': data.find(b'\r\n\r\n'), 'first_lf_header_separator_offset': data.find(b'\n\n'),
            'leading_u32le_matches_total_size': len(data) >= 4 and int.from_bytes(data[:4], 'little') == before[2],
            'leading_u32be_matches_total_size': len(data) >= 4 and int.from_bytes(data[:4], 'big') == before[2]})
    report['script_sha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(OUTPUT), 'sample_count': len(report['samples']), 'samples': report['samples']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
