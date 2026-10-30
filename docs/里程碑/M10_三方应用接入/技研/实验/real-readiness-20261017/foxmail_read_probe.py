#!/usr/bin/env python3
"""Authorized local read PoC. Emit checks only; never mutate the source mailbox."""
from __future__ import annotations
import argparse
import datetime as dt
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
import hashlib
import html
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
import time
import unicodedata

ROOT = Path('/Users/liubu/Library/Containers/com.tencent.Foxmail/Data/Library/Foxmail/Profiles')
MAX_FILES = 20000
MAX_BYTES = 8 * 1024 * 1024


def stamp(path):
    s = path.stat()
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)


def address_set(value):
    return {address.strip().casefold() for _, address in getaddresses([str(value or '')]) if address}


def normalize(value):
    return re.sub(r'\s+', '', html.unescape(str(value or '')))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--ui-subject')
    ap.add_argument('--ui-from')
    ap.add_argument('--ui-to')
    ap.add_argument('--ui-body-phrase', action='append', default=[])
    args = ap.parse_args()
    started = time.monotonic()
    report = {'schema': 'm10-foxmail-real-read-poc-v1', 'at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'source': 'Foxmail 1.5.8 local profile; account omitted',
              'sourceOpenMode': 'SQLite mode=ro + query_only; files rb; no writes/checkpoints/copies',
              'fileBudget': MAX_FILES, 'perMessageByteBudget': MAX_BYTES,
              'credentialsUsed': False, 'networkUsed': False, 'sourceContentsSaved': False,
              'profiles': [], 'samples': [], 'errors': []}
    for profile in sorted(ROOT.iterdir()):
        if not profile.is_dir() or profile.is_symlink() or not (profile / 'messages.db').is_file():
            continue
        db = sqlite3.connect((profile / 'messages.db').as_uri() + '?mode=ro', uri=True, timeout=2)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        inventory = {}
        duplicates = set()
        scanned = 0
        for here, dirs, names in os.walk(profile / 'Mail', followlinks=False):
            dirs[:] = sorted(d for d in dirs if not (Path(here) / d).is_symlink())
            for name in sorted(names):
                path = Path(here) / name
                if path.is_symlink() or path.suffix != '.mail':
                    continue
                scanned += 1
                if scanned > MAX_FILES:
                    raise RuntimeError('Source filename budget exceeded')
                if path.stem.isdecimal():
                    native_id = int(path.stem)
                    if native_id in inventory:
                        duplicates.add(native_id)
                    else:
                        inventory[native_id] = path
        total = db.execute('SELECT COUNT(*) FROM mailinfo').fetchone()[0]
        all_db_ids = {row[0] for row in db.execute('SELECT mailid FROM mailinfo')}
        selected = list(sorted(inventory))[:3]
        ui_id = None
        if args.ui_subject:
            # Exact user-visible subject is used only in memory, never in output.
            rows = db.execute('SELECT mailid FROM mailinfo WHERE subject = ? ORDER BY mailid DESC LIMIT 2', (args.ui_subject,)).fetchall()
            if len(rows) == 1 and rows[0][0] in inventory:
                ui_id = rows[0][0]
                if ui_id not in selected:
                    selected.append(ui_id)
            else:
                report['errors'].append('UI spot-check exact subject did not identify one unique local source')
        report['profiles'].append({'indexedRows': total, 'sourceMailFiles': scanned,
                                   'numericFilenameIDs': len(inventory), 'duplicateNativeFileIDs': len(duplicates),
                                   'allDatabaseIDsEqualAllSourceFilenameIDs': all_db_ids == set(inventory),
                                   'databaseIDsWithoutSourceFiles': len(all_db_ids - set(inventory)),
                                   'sourceFilesWithoutDatabaseIDs': len(set(inventory) - all_db_ids),
                                   'uiSpotCheckLocatedUniquely': ui_id is not None if args.ui_subject else None})
        with tempfile.TemporaryDirectory(prefix='m10-foxmail-local-index-') as temp:
            own = sqlite3.connect(str(Path(temp) / 'index.sqlite'))
            own.execute('CREATE TABLE objects(source TEXT,native_id TEXT,revision TEXT,PRIMARY KEY(source,native_id))')
            for native_id in selected:
                item = {'sample': len(report['samples']) + 1, 'uiSpotCheck': native_id == ui_id}
                path = inventory[native_id]
                if native_id in duplicates:
                    item['status'] = 'ambiguous_source_id'
                    report['samples'].append(item)
                    continue
                row = db.execute('SELECT mailid,subject,from_,to_,messageid,size,fileexist,attachment FROM mailinfo WHERE mailid=?', (native_id,)).fetchone()
                item['nativeDecimalFilenameMatchesDatabasePrimaryKey'] = row is not None and row['mailid'] == int(path.stem)
                if row is None:
                    item['status'] = 'missing_database_row'
                    report['samples'].append(item)
                    continue
                before = stamp(path)
                if before[2] > MAX_BYTES:
                    item['status'] = 'over_byte_budget'
                    report['samples'].append(item)
                    continue
                data = path.read_bytes()
                after = stamp(path)
                msg = BytesParser(policy=policy.default).parsebytes(data)
                parts = list(msg.walk())
                if len(parts) > 256:
                    raise RuntimeError('MIME part budget exceeded')
                leaves = [p for p in parts if not p.is_multipart()]
                text_variants = []
                attachment_leaves = []
                decoded_bytes = 0
                for part in leaves:
                    decoded = part.get_payload(decode=True) or b''
                    decoded_bytes += len(decoded)
                    if decoded_bytes > 16 * 1024 * 1024:
                        raise RuntimeError('MIME decoded byte budget exceeded')
                    if part.get_content_maintype() == 'text' and part.get_content_disposition() != 'attachment':
                        text_variants.append(decoded.decode(part.get_content_charset() or 'utf-8', errors='replace'))
                    if part.get_filename() or part.get_content_disposition() == 'attachment':
                        attachment_leaves.append(part)
                body_text = '\n'.join(text_variants)
                visible_text = re.sub('<[^>]+>', ' ', body_text)
                att_rows = db.execute('SELECT filename,displayname,filesize,fileisexist FROM attachmentinfo WHERE mailid=? LIMIT 101', (native_id,)).fetchall()
                boxes = db.execute('SELECT mail_id,mail_folderid,mail_hidden FROM mail_box_info WHERE mail_id=? LIMIT 101', (native_id,)).fetchall()
                mime_attachment_names = {str(p.get_filename()) for p in attachment_leaves if p.get_filename()}
                db_attachment_names = {str(r['displayname'] or r['filename']) for r in att_rows}
                source_subject = str(msg['subject'] or '')
                index_subject = str(row['subject'] or '')
                subject_differences = [(a, b) for a, b in zip(source_subject, index_subject) if a != b]
                decoded_by_name = {str(p.get_filename()): len(p.get_payload(decode=True) or b'') for p in attachment_leaves if p.get_filename()}
                attachment_size_checks = [decoded_by_name.get(str(r['displayname'] or r['filename'])) == r['filesize'] for r in att_rows]
                item.update({'sourceStableDuringRead': before == after,
                             'fileBytes': len(data), 'databaseSizeMatchesSource': row['size'] == len(data),
                             'sourceFileExistsFlag': row['fileexist'],
                             'subjectMatchesDatabase': normalize(msg['subject']) == normalize(row['subject']),
                             'subjectDifferenceOnlyPunctuation': bool(subject_differences) and len(source_subject) == len(index_subject) and all(unicodedata.category(a).startswith('P') and unicodedata.category(b).startswith('P') for a, b in subject_differences),
                             'fromAddressesMatchDatabase': address_set(msg['from']) == address_set(row['from_']),
                             'toAddressesMatchDatabase': address_set(msg['to']) == address_set(row['to_']),
                             'messageIDMatchesDatabase': str(msg['message-id'] or '').strip().strip('<>') == str(row['messageid'] or '').strip().strip('<>'),
                             'bodyTextVariantCount': len(text_variants), 'nonEmptyDecodedText': bool(normalize(visible_text)),
                             'mimePartCount': len(parts), 'reportedDefectCount': sum(len(p.defects) for p in parts),
                             'databaseAttachmentCount': len(att_rows), 'mimeNamedAttachmentCount': len(attachment_leaves),
                             'explicitAttachmentPartCount': sum(p.get_content_disposition() == 'attachment' for p in leaves),
                             'namedInlineOrCIDPartCount': sum(bool(p.get_filename()) and (p.get_content_disposition() == 'inline' or bool(p['Content-ID'])) for p in leaves),
                             'attachmentDisplayNameSetsEqual': mime_attachment_names == db_attachment_names,
                             'indexedAttachmentDecodedSizeMatches': attachment_size_checks,
                             'folderRelationRows': len(boxes), 'allFolderRelationsMatchNativeID': all(r['mail_id'] == native_id for r in boxes)})
                if native_id == ui_id:
                    item['uiComparison'] = {
                        'subjectMatchesObservedUI': normalize(msg['subject']) == normalize(args.ui_subject),
                        'senderMatchesObservedUI': args.ui_from.casefold() in address_set(msg['from']) if args.ui_from else None,
                        'recipientMatchesObservedUI': args.ui_to.casefold() in address_set(msg['to']) if args.ui_to else None,
                        'observedBodyPhraseCount': len(args.ui_body_phrase),
                        'observedBodyPhrasesPresent': all(normalize(p) in normalize(visible_text) for p in args.ui_body_phrase),
                        'scope': 'Visible subject/sender/recipient and limited body phrases only; not complete visual/attachment fidelity.'}
                revision = hashlib.sha256(data).hexdigest()
                own.execute('INSERT INTO objects VALUES(?,?,?) ON CONFLICT(source,native_id) DO UPDATE SET revision=excluded.revision', ('sample-source', str(native_id), revision))
                reread = path.read_bytes()
                row_again = db.execute('SELECT mailid,subject,from_,to_,messageid,size,fileexist,attachment FROM mailinfo WHERE mailid=?', (native_id,)).fetchone()
                item['immediateRepeatedReadSameBytesAndIndexRow'] = data == reread and tuple(row) == tuple(row_again)
                own.execute('INSERT INTO objects VALUES(?,?,?) ON CONFLICT(source,native_id) DO UPDATE SET revision=excluded.revision', ('sample-source', str(native_id), hashlib.sha256(reread).hexdigest()))
                item['status'] = 'read_and_compared'
                report['samples'].append(item)
            own.commit()
            report['temporaryOwnIndex'] = {'sampleObjects': own.execute('SELECT COUNT(*) FROM objects').fetchone()[0],
                                          'repeatedImportCreatesNoDuplicates': own.execute('SELECT COUNT(*) FROM objects').fetchone()[0] == sum(s.get('status') == 'read_and_compared' for s in report['samples']),
                                          'deletedAfterProbe': True, 'realSourceIDsOrRevisionsSavedInReport': False}
            own.close()
        db.close()
    report['elapsedSeconds'] = round(time.monotonic() - started, 3)
    report['limitations'] = ['Small real sample only; no whole-mailbox content validation.',
                             'No source edits, receive action, live incremental event, move/delete or client-upgrade test.',
                             'Immediate repeated reads are not proof of long-term stable identity.',
                             'CLI read permission is not packaged Electron permission.',
                             'Attachments are parsed and metadata compared in memory; not opened or executed.']
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'report': str(args.output), 'samples': len(report['samples']), 'errors': report['errors']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
