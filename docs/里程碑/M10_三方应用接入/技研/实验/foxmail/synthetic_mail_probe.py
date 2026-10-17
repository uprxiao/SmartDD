#!/usr/bin/env python3
"""Synthetic RFC mail experiment. Never reads Foxmail or uses a network client."""
from __future__ import annotations

from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
import datetime as dt
import hashlib
import json
import mailbox
import os
from pathlib import Path
import tempfile

ROOT = Path(__file__).parent


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fixture(message_id: str | None, text: str = '合成正文\nFrom synthetic body line\n') -> bytes:
    m = EmailMessage(policy=policy.SMTP)
    m['From'] = 'sender@example.invalid'
    m['To'] = 'recipient@example.invalid'
    m['Subject'] = '合成 UTF-8 邮件'
    if message_id:
        m['Message-ID'] = message_id
    m['Date'] = 'Sat, 17 Oct 2026 10:00:00 +0800'
    m.set_content(text, charset='utf-8')
    m.add_alternative('<p>合成 HTML</p><img src="cid:fixture-image"><img src="https://example.invalid/tracker"><script>void 0</script>', subtype='html')
    m.get_payload()[1].add_related(b'not-a-real-image', maintype='image', subtype='png', cid='<fixture-image>')
    m.add_attachment(b'synthetic attachment A', maintype='application', subtype='octet-stream', filename='../../escape.txt')
    m.add_attachment(b'synthetic attachment B', maintype='application', subtype='octet-stream', filename='escape.txt')
    return m.as_bytes()


def reference(source_id: str, native_id: str) -> str:
    # Candidate reference format, not a claim about Foxmail native IDs.
    return 'mail:' + digest((source_id + '\0' + native_id).encode())


def parse(raw: bytes, source_id: str, native_id: str) -> dict:
    m = BytesParser(policy=policy.default).parsebytes(raw)
    defects = sorted({type(d).__name__ for p in m.walk() for d in p.defects})
    parts = []
    for i, p in enumerate(m.walk()):
        if p.is_multipart():
            continue
        content = p.get_payload(decode=True) or b''
        if p.get_filename() or p.get_content_disposition() == 'attachment' or p.get('Content-ID'):
            parts.append({'part_id': str(i), 'bytes': len(content), 'sha256': digest(content),
                          'content_type': p.get_content_type(), 'has_cid': bool(p.get('Content-ID')),
                          'declared_name': p.get_filename(), '_payload': content})
    return {'reference': reference(source_id, native_id), 'content_version': digest(raw),
            'message_id': str(m.get('Message-ID', '')), 'subject': str(m['Subject']),
            'plain': m.get_body(preferencelist=('plain',)).get_content(),
            'has_html': m.get_body(preferencelist=('html',)) is not None,
            'html_rendered': False, 'remote_resources_fetched': False,
            'parse_defects': defects, 'complete_candidate': not defects, 'parts': parts}


def materialize(parts: list[dict], target: Path, quota: int = 4096) -> list[Path]:
    if sum(p['bytes'] for p in parts) > quota:
        raise ValueError('attachment quota exceeded')
    target.mkdir(mode=0o700)
    saved = []
    for p in parts:
        # Do not use the MIME-supplied filename as a filesystem component.
        dst = target / (p['part_id'] + '-' + p['sha256'])
        with dst.open('xb') as f:
            f.write(p['_payload'])
        os.chmod(dst, 0o600)
        saved.append(dst)
    return saved


def main() -> None:
    checks = []
    def check(name: str, value: bool, detail: str) -> None:
        checks.append({'id': name, 'passed': bool(value), 'detail': detail})
        if not value:
            raise AssertionError(name)
    a = fixture('<same-id@example.invalid>')
    parsed = parse(a, 'synthetic-source-A', 'synthetic-row-1')
    check('S01_UTF8_MULTIPART', parsed['subject'] == '合成 UTF-8 邮件' and '合成正文' in parsed['plain'] and len(parsed['parts']) == 3,
          'UTF-8, alternative text/HTML, inline CID and two separate attachments parsed from synthetic EML.')
    check('S02_NO_RENDER_OR_FETCH', parsed['has_html'] and not parsed['html_rendered'] and not parsed['remote_resources_fetched'],
          'Parser classifies HTML; no browser renderer or network API is used. This does not validate an HTML sanitizer.')
    check('S03_STABLE_REFERENCE', parsed['reference'] == parse(a, 'synthetic-source-A', 'synthetic-row-1')['reference'],
          'Re-reading the same candidate source/native ID preserves its reference.')
    changed = parse(fixture('<same-id@example.invalid>', 'changed synthetic text'), 'synthetic-source-A', 'synthetic-row-1')
    check('S04_CONTENT_REVISION', changed['reference'] == parsed['reference'] and changed['content_version'] != parsed['content_version'],
          'A changed payload updates content revision without changing the source-native reference.')
    check('S05_SOURCE_AND_HEADER_COLLISIONS', reference('synthetic-source-B', 'synthetic-row-1') != parsed['reference'] and reference('synthetic-source-A', 'synthetic-row-2') != parsed['reference'],
          'Equal Message-ID or native IDs in different sources cannot merge unrelated local records.')
    no_id = parse(fixture(None), 'synthetic-source-A', 'synthetic-row-no-header-id')
    check('S06_MISSING_MESSAGE_ID', not no_id['message_id'] and bool(no_id['reference']),
          'A source-native reference does not require the optional RFC Message-ID header.')
    malformed = b'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="absent"\r\n\r\nsynthetic incomplete data\r\n'
    bad = BytesParser(policy=policy.default).parsebytes(malformed)
    defects = [type(d).__name__ for p in bad.walk() for d in p.defects]
    check('S07_MALFORMED_MIME', bool(defects), 'Malformed synthetic MIME produces parser defects and must not be silently marked complete.')
    with tempfile.TemporaryDirectory(prefix='m10-foxmail-synthetic-') as td:
        temp = Path(td)
        extracted = materialize(parsed['parts'], temp / 'isolated')
        check('S08_ATTACHMENT_ISOLATION', all(p.parent == temp / 'isolated' for p in extracted) and len({p.name for p in extracted}) == 3 and not (temp / 'escape.txt').exists(),
              'Traversal-style MIME filename and duplicate display name cannot escape or overwrite the isolated ID/hash paths.')
        check('S09_PRIVATE_OUTPUT_MODES', (temp / 'isolated').stat().st_mode & 0o777 == 0o700 and all(p.stat().st_mode & 0o777 == 0o600 for p in extracted),
              'Synthetic extraction creates 0700 directory and 0600 files.')
        quota_blocked = False
        try:
            materialize(parsed['parts'], temp / 'over-quota', quota=1)
        except ValueError:
            quota_blocked = True
        check('S10_QUOTA_BEFORE_WRITE', quota_blocked and not (temp / 'over-quota').exists(), 'Attachment budget is checked before creating output files.')
        mbox_path = temp / 'fixture.mbox'
        box = mailbox.mbox(str(mbox_path), create=True)
        box.lock()
        try:
            box.add(a)
            box.add(fixture('<second-id@example.invalid>'))
            box.flush()
        finally:
            box.unlock(); box.close()
        readbox = mailbox.mbox(str(mbox_path), create=False)
        try:
            messages = list(readbox)
            ids = [str(m['Message-ID']) for m in messages]
        finally:
            readbox.close()
        check('S11_MBOX_BOUNDARIES', len(messages) == 2 and ids == ['<same-id@example.invalid>', '<second-id@example.invalid>'],
              'Two synthetic messages survive mbox boundaries; the body From line does not create a false third message.')
        check('S12_MBOX_FORMAT_NOT_BYTE_IDENTITY', digest(mbox_path.read_bytes()) != digest(a),
              'An mbox container is not a raw EML byte identity; preserve source-native references separately from transport packaging.')
    report = {'schema': 'm10-foxmail-synthetic-parser-v1', 'at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'input': 'synthetic_only', 'dependencies': 'Python standard library only', 'network_calls': 0,
              'foxmail_files_read': 0, 'checks': checks, 'passed': all(c['passed'] for c in checks),
              'script_sha256': digest(Path(__file__).read_bytes()),
              'limits': ['No real Foxmail MIME content parsed.', 'No live mailbox/index-to-file mapping or incremental synchronization verified.',
                         'No HTML rendering/sanitizer verified.', 'No client automation, account login or actual sending performed.']}
    output = ROOT / 'synthetic-parser-report.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(output), 'checks': len(checks), 'passed': report['passed']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
