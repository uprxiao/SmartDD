#!/usr/bin/env python3
"""Bounded real Foxmail MIME structure probe with anonymous aggregate output.

The original deterministic three-sample selection is preserved. Only full files
up to 2 MiB are parsed. No header values, text, names, IDs, raw data or content
hashes are returned or saved. No renderer, network client or DB query is used.
"""
from __future__ import annotations

import datetime as dt
from email import policy
from email.parser import BytesParser
import hashlib
import json
import os
from pathlib import Path
import re

ROOT = Path('/Users/liubu/Library/Containers/com.tencent.Foxmail/Data/Library/Foxmail/Profiles')
OUTPUT = Path(__file__).with_name('private-mime-structure-report.json')
LAYOUT = Path(__file__).with_name('private-format-report.json')
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_PARTS = 256
MAX_DEPTH = 24
MAX_DECODED_BYTES = 8 * 1024 * 1024


def stamp(p: Path) -> tuple[int, int, int, int]:
    s = p.stat()
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)


def select_original_order() -> list[Path]:
    found = []
    for profile in sorted(ROOT.iterdir()):
        if not profile.is_dir() or profile.is_symlink():
            continue
        for here, dirs, files in os.walk(profile / 'Mail', followlinks=False):
            dirs[:] = sorted(d for d in dirs if not (Path(here) / d).is_symlink())
            for name in sorted(files):
                p = Path(here) / name
                if p.suffix == '.mail' and not p.is_symlink():
                    found.append(p)
                    if len(found) == 3:
                        return found
    return found


def mime_type(p) -> str:
    value = p.get_content_type().lower()
    if re.fullmatch(r'[a-z0-9!#$&^_.+\-]+/[a-z0-9!#$&^_.+\-]+', value):
        return value
    return '<invalid-mime-type>'


def structure(raw: bytes) -> dict:
    message = BytesParser(policy=policy.default).parsebytes(raw)
    result = {'root_mime_type': mime_type(message), 'mime_types': [], 'part_count': 0, 'leaf_part_count': 0,
              'max_part_depth': 0, 'has_plain_text': False, 'has_html': False, 'has_inline_resource': False,
              'attachment_count': 0, 'decoded_attachment_bytes': 0, 'decoded_leaf_bytes': 0,
              'defect_types': [], 'encrypted_or_signed_mime': False, 'encrypted_mime': False,
              'structure_budget_exceeded': False, 'decoded_byte_budget_exceeded': False}
    types = set()
    defects = set()
    queue = [(message, 0)]
    while queue:
        part, depth = queue.pop()
        result['part_count'] += 1
        result['max_part_depth'] = max(depth, result['max_part_depth'])
        if result['part_count'] > MAX_PARTS or depth > MAX_DEPTH:
            result['structure_budget_exceeded'] = True
            break
        content_type = mime_type(part)
        types.add(content_type)
        defects.update(type(d).__name__ for d in part.defects)
        if content_type in {'multipart/encrypted', 'application/pkcs7-mime', 'application/x-pkcs7-mime'}:
            result['encrypted_mime'] = True
        if result['encrypted_mime'] or content_type in {'multipart/signed', 'application/pkcs7-signature', 'application/pgp-signature'}:
            result['encrypted_or_signed_mime'] = True
        if part.is_multipart():
            queue.extend((child, depth + 1) for child in reversed(part.get_payload()))
            continue
        result['leaf_part_count'] += 1
        result['has_plain_text'] |= content_type == 'text/plain'
        result['has_html'] |= content_type == 'text/html'
        inline = bool(part.get('Content-ID')) or part.get_content_disposition() == 'inline'
        result['has_inline_resource'] |= inline
        attachment = part.get_content_disposition() == 'attachment' or part.get_filename() is not None
        result['attachment_count'] += int(attachment)
        payload = part.get_payload(decode=True) or b''
        result['decoded_leaf_bytes'] += len(payload)
        if attachment:
            result['decoded_attachment_bytes'] += len(payload)
        defects.update(type(d).__name__ for d in part.defects)
        if result['decoded_leaf_bytes'] > MAX_DECODED_BYTES:
            result['decoded_byte_budget_exceeded'] = True
            break
    result['mime_types'] = sorted(types)
    result['defect_types'] = sorted(defects)
    result['structural_parse_status'] = ('budget_limited' if result['structure_budget_exceeded'] or result['decoded_byte_budget_exceeded']
                                         else 'encrypted_mime_not_decrypted' if result['encrypted_mime']
                                         else 'parsed_with_defects' if defects else 'parsed_without_reported_defects')
    return result


def main() -> None:
    previous = json.loads(LAYOUT.read_text())['samples']
    samples = []
    for i, p in enumerate(select_original_order(), 1):
        before = stamp(p)
        expected_size = previous[i - 1]['file_bytes'] if i <= len(previous) else None
        entry = {'sample': i, 'file_bytes': before[2], 'matches_original_layout_file_size': before[2] == expected_size,
                 'source_stable_during_read': None}
        if before[2] != expected_size:
            entry['status'] = 'skipped_original_selection_metadata_changed'
        elif before[2] > MAX_FILE_BYTES:
            entry['status'] = 'skipped_file_size_budget'
        else:
            try:
                with p.open('rb') as f:
                    raw = f.read(MAX_FILE_BYTES + 1)
                after = stamp(p)
                entry['source_stable_during_read'] = before == after
                if before != after or len(raw) != before[2]:
                    entry['status'] = 'skipped_source_changed_or_incomplete_read'
                elif len(raw) > MAX_FILE_BYTES:
                    entry['status'] = 'skipped_file_size_budget'
                else:
                    entry.update(structure(raw))
                    entry['status'] = 'full_file_structure_parsed'
            except Exception as e:
                # Exception messages may contain source data: persist only class.
                entry['status'] = 'parse_failed'
                entry['error_type'] = type(e).__name__
        samples.append(entry)
    report = {'schema': 'm10-foxmail-private-mime-structure-v1', 'at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'selection': 'same deterministic order as private_layout_probe.py; size checked against prior anonymous layout report',
              'max_file_bytes': MAX_FILE_BYTES, 'max_parts': MAX_PARTS, 'max_depth': MAX_DEPTH,
              'max_decoded_leaf_bytes': MAX_DECODED_BYTES, 'sample_count': len(samples), 'samples': samples,
              'real_header_values_saved': False, 'real_text_or_attachment_bytes_saved': False,
              'real_filenames_or_ids_saved': False, 'real_content_hashes_saved': False,
              'rendering_or_network': False, 'source_writes': False,
              'script_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'limits': ['Structure only, not content fidelity or client-side comparison.',
                         'File sizes and deterministic selection are not a permanent source identity proof.',
                         'No database row/native-ID mapping, full mailbox coverage, signatures or decryption verified.']}
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
