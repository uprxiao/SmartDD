"""Independent, read-only reference reader for a real Foxmail profile (T13-T16 real-source comparison).

Only hashes, counts and ids leave this process: no subject, address or body text is ever printed.
Usage:
  real-foxmail-reference.py index   <profile>                  -> JSON map mailid -> relative .mail path
  real-foxmail-reference.py window  <profile> <days,...>       -> expected id sets per natural-day window (MIME Date header, local tz)
  real-foxmail-reference.py inspect <profile> <mailid,...>     -> per-mail raw sha256/size, normalized text/html hash, attachment hashes
"""
import email, email.policy, hashlib, json, os, re, sqlite3, sys
from datetime import datetime, timedelta

profile = sys.argv[2]
db_uri = 'file:' + os.path.join(profile, 'messages.db') + '?mode=ro&immutable=1'


def sha(b):
    return hashlib.sha256(b).hexdigest()


def index():
    out = {}
    for base, _dirs, files in os.walk(os.path.join(profile, 'Mail')):
        for f in files:
            if f.endswith('.mail'):
                out[f[:-5]] = os.path.relpath(os.path.join(base, f), profile)
    return out


def norm(text):
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    return '\n'.join(line.rstrip() for line in text.split('\n')).strip()


def parse(raw):
    return email.message_from_bytes(raw, policy=email.policy.default)


def date_epoch(msg):
    try:
        d = email.utils.parsedate_to_datetime(msg['Date'])
        return d.timestamp()
    except Exception:
        return None


def main():
    cmd = sys.argv[1]
    idx = index()
    if cmd == 'index':
        print(json.dumps(idx))
        return
    if cmd == 'window':
        days = [int(x) for x in sys.argv[3].split(',')]
        conn = sqlite3.connect(db_uri, uri=True)
        now = datetime.now().astimezone()
        widest = max(days)
        lo = (now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=widest + 2)).timestamp()
        ids = [str(r[0]) for r in conn.execute('select mailid from mailinfo where date>=?', (int(lo),))]
        conn.close()
        stamps = {}
        for i in ids:
            p = idx.get(i)
            if not p:
                continue
            with open(os.path.join(profile, p), 'rb') as fh:
                head = fh.read(65536)
            msg = email.message_from_bytes(head, policy=email.policy.default)
            stamps[i] = date_epoch(msg)
        out = {}
        for n in days:
            start = (now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=n - 1)).timestamp()
            out[str(n)] = sorted(i for i, t in stamps.items() if t is not None and start <= t <= now.timestamp())
        out['noDate'] = sorted(i for i, t in stamps.items() if t is None)
        out['startOfToday'] = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        print(json.dumps(out))
        return
    if cmd == 'find':
        marker = sys.argv[3]
        out = []
        for attempt in range(2):
            uri = db_uri if attempt else db_uri.replace('&immutable=1', '')
            try:
                conn = sqlite3.connect(uri, uri=True, timeout=5)
                rows = conn.execute('select mailid, date from mailinfo where subject like ?', ('%' + marker + '%',)).fetchall()
                conn.close()
                break
            except Exception:
                rows = []
        for mid, date in rows:
            p = idx.get(str(mid))
            if p:
                with open(os.path.join(profile, p), 'rb') as fh:
                    raw = fh.read()
                out.append({'id': str(mid), 'date': date, 'rawSha256': sha(raw), 'rawSize': len(raw)})
        print(json.dumps(out))
        return
    if cmd == 'classify':
        conn = sqlite3.connect(db_uri, uri=True)
        res = {}
        for i in sys.argv[3].split(','):
            row = conn.execute('select size,attachment,attachment_delete,mail_download_type,mailparsehugeattachment,fileexist,inline_attch_exist from mailinfo where mailid=?', (i,)).fetchone()
            p = idx.get(i)
            raw = os.path.getsize(os.path.join(profile, p)) if p else None
            atts = []
            if p:
                att_dir = os.path.join(profile, os.path.dirname(p))
                atts = [f for f in os.listdir(att_dir) if f.startswith(i + '.') and not f.endswith('.mail')]
            res[i] = {'rawSize': raw, 'clientSize': row[0] if row else None, 'attachments': row[1] if row else None, 'attachmentDeleted': row[2] if row else None,
                      'downloadType': row[3] if row else None, 'hugeAttachment': row[4] if row else None, 'fileexist': row[5] if row else None, 'inlineAttach': row[6] if row else None,
                      'attachmentFilesOnDisk': len(atts)}
        conn.close()
        print(json.dumps(res))
        return
    if cmd == 'inspect':
        res = {}
        for i in sys.argv[3].split(','):
            p = idx.get(i)
            if not p:
                res[i] = {'missing': True}
                continue
            with open(os.path.join(profile, p), 'rb') as fh:
                raw = fh.read()
            msg = parse(raw)
            text = html = None
            try:
                body = msg.get_body(preferencelist=('plain',))
                text = norm(body.get_content()) if body else None
            except Exception:
                text = None
            try:
                body = msg.get_body(preferencelist=('html',))
                html = body.get_content() if body and body.get_content_type() == 'text/html' else None
            except Exception:
                html = None
            atts = []
            for part in msg.iter_attachments():
                payload = part.get_payload(decode=True) or b''
                atts.append({'filenameSha': sha((part.get_filename() or '').encode()), 'size': len(payload), 'sha256': sha(payload), 'cid': part.get('Content-ID')})
            res[i] = {'rawSha256': sha(raw), 'rawSize': len(raw), 'textSha256': sha(text.encode()) if text is not None else None,
                      'hasHtml': html is not None, 'htmlLen': len(html) if html else 0, 'attachments': atts,
                      'dateEpoch': date_epoch(msg), 'messageIdSha': sha((msg['Message-ID'] or '').encode()), 'subjectSha': sha((msg['Subject'] or '').encode())}
        print(json.dumps(res))
        return


main()
