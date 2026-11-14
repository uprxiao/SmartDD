"""Candidate protocol only. Isolated SQLite and deterministic transport; not product code."""
import copy
import hashlib
import itertools
import json
from pathlib import Path
import sqlite3
import tempfile
import traceback
import uuid

ROOT = Path(__file__).resolve().parent
RESULTS = []


class Conflict(Exception):
    pass


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


class Host:
    def __init__(self, file):
        self.db = sqlite3.connect(file, isolation_level=None)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS meta(id TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, seq INTEGER NOT NULL, pruned INTEGER NOT NULL, projection TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS events(task TEXT, seq INTEGER, body TEXT NOT NULL, PRIMARY KEY(task,seq));
          CREATE TABLE IF NOT EXISTS drafts(task TEXT PRIMARY KEY, rev INTEGER NOT NULL, selection INTEGER NOT NULL, text TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS receipts(task TEXT, op TEXT, digest TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(task,op));
          CREATE TABLE IF NOT EXISTS outbox(task TEXT, op TEXT, text TEXT NOT NULL, selection INTEGER NOT NULL, PRIMARY KEY(task,op));
          CREATE TABLE IF NOT EXISTS creations(op TEXT PRIMARY KEY, digest TEXT NOT NULL, task TEXT NOT NULL);
        ''')
        if not self.db.execute('SELECT id FROM meta').fetchone():
            self.db.execute('INSERT INTO meta VALUES (?)', (str(uuid.uuid4()),))
        self.identity = self.db.execute('SELECT id FROM meta').fetchone()[0]
        self.listeners = []

    def task(self, task):
        self.db.execute('INSERT INTO tasks VALUES (?,0,0,?)', (task, json.dumps({'generation': 1, 'items': {}})))
        self.db.execute('INSERT INTO drafts VALUES (?,0,1,?)', (task, ''))

    def publish(self, task):
        notice = self.watermark(task)
        for callback in self.listeners:
            callback(copy.deepcopy(notice))

    def watermark(self, task):
        return {'database': self.identity, 'task': task, 'seq': self.db.execute('SELECT seq FROM tasks WHERE id=?', (task,)).fetchone()[0]}

    @staticmethod
    def reduce(projection, event):
        p = copy.deepcopy(projection)
        kind = event['kind']
        if kind == 'generation':
            p['generation'] = event['generation']
        elif kind == 'item':
            old = p['items'].get(event['id'])
            if old and (event['rev'] <= old['rev'] or old['state'] in ('done', 'deleted') and event['state'] == 'streaming'):
                raise Conflict('item revision or terminal regression')
            p['items'][event['id']] = {k: event[k] for k in ('rev', 'state', 'text')}
        elif kind != 'advisory':
            raise Conflict('unknown required event')
        return p

    def commit(self, task, event, generation=None, publish=True, fail=False):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            seq, raw = self.db.execute('SELECT seq,projection FROM tasks WHERE id=?', (task,)).fetchone()
            p = json.loads(raw)
            if generation is not None and generation != p['generation']:
                raise Conflict('stale runtime generation')
            p = self.reduce(p, event)
            seq += 1
            self.db.execute('UPDATE tasks SET seq=?,projection=? WHERE id=?', (seq, json.dumps(p), task))
            self.db.execute('INSERT INTO events VALUES (?,?,?)', (task, seq, json.dumps(event)))
            if fail:
                raise Conflict('injected pre-commit failure')
            self.db.execute('COMMIT')
        except BaseException:
            self.db.execute('ROLLBACK')
            raise
        if publish:
            self.publish(task)
        return seq

    def snapshot(self, task, interleave=None):
        self.db.execute('BEGIN')
        try:
            seq = self.db.execute('SELECT seq FROM tasks WHERE id=?', (task,)).fetchone()[0]
            if interleave:
                interleave()
            p = self.db.execute('SELECT projection FROM tasks WHERE id=?', (task,)).fetchone()[0]
            self.db.execute('COMMIT')
            return {'database': self.identity, 'task': task, 'seq': seq, 'projection': json.loads(p)}
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def replay(self, task, database, after, through, limit=2):
        self.db.execute('BEGIN')
        try:
            high, pruned = self.db.execute('SELECT seq,pruned FROM tasks WHERE id=?', (task,)).fetchone()
            if database != self.identity or after < pruned or after > high or through > high:
                return {'snapshotRequired': True}
            rows = self.db.execute('SELECT seq,body FROM events WHERE task=? AND seq>? AND seq<=? ORDER BY seq LIMIT ?', (task, after, through, limit)).fetchall()
            return {'database': database, 'task': task, 'through': through, 'events': [{'seq': seq, 'body': json.loads(body)} for seq, body in rows]}
        finally:
            self.db.execute('COMMIT')

    def prune(self, task, through):
        self.db.execute('BEGIN IMMEDIATE')
        self.db.execute('DELETE FROM events WHERE task=? AND seq<=?', (task, through))
        self.db.execute('UPDATE tasks SET pruned=? WHERE id=?', (through, task))
        self.db.execute('COMMIT')

    def draft(self, task):
        rev, selection, text = self.db.execute('SELECT rev,selection,text FROM drafts WHERE task=?', (task,)).fetchone()
        return {'rev': rev, 'selection': selection, 'text': text}

    def command(self, task, op, kind, expected, text='', selection=None, fail=False):
        request = {'kind': kind, 'expected': expected, 'text': text, 'selection': selection}
        fingerprint = digest(request)
        self.db.execute('BEGIN IMMEDIATE')
        try:
            prior = self.db.execute('SELECT digest,body FROM receipts WHERE task=? AND op=?', (task, op)).fetchone()
            if prior:
                if prior[0] != fingerprint:
                    raise Conflict('idempotency key reused with different request')
                self.db.execute('COMMIT')
                return json.loads(prior[1])
            before = self.draft(task)
            if before['rev'] != expected:
                raise Conflict('draft CAS')
            if kind in ('insert', 'send') and selection != before['selection']:
                raise Conflict('selection CAS')
            if kind == 'save':
                after_text = text
            elif kind == 'insert':
                after_text = before['text'] + text
            elif kind == 'send':
                if text != before['text']:
                    raise Conflict('send text is not saved draft')
                self.db.execute('INSERT INTO outbox VALUES (?,?,?,?)', (task, op, text, selection))
                after_text = ''
            else:
                raise Conflict('bad command')
            after = {**before, 'rev': expected + 1, 'text': after_text}
            self.db.execute('UPDATE drafts SET rev=?,text=? WHERE task=?', (after['rev'], after_text, task))
            receipt = {'task': task, 'op': op, **after}
            self.db.execute('INSERT INTO receipts VALUES (?,?,?,?)', (task, op, fingerprint, json.dumps(receipt)))
            if fail:
                raise Conflict('injected transaction failure')
            self.db.execute('COMMIT')
            return receipt
        except BaseException:
            self.db.execute('ROLLBACK')
            raise

    def create_first(self, op, text):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            old = self.db.execute('SELECT digest,task FROM creations WHERE op=?', (op,)).fetchone()
            if old:
                if old[0] != digest(text):
                    raise Conflict('creation ID reused')
                task = old[1]
            else:
                task = str(uuid.uuid4())
                self.task(task)
                self.db.execute('INSERT INTO creations VALUES (?,?,?)', (op, digest(text), task))
                self.db.execute('INSERT INTO outbox VALUES (?,?,?,1)', (task, op, text))
            self.db.execute('COMMIT')
            return task
        except BaseException:
            self.db.execute('ROLLBACK')
            raise


class Replica:
    def __init__(self):
        self.epoch = 0
        self.select('A')

    def select(self, task):
        self.epoch += 1
        self.task = task
        self.database = None
        self.cursor = 0
        self.desired = 0
        self.projection = None
        self.pending_database = None
        return self.epoch

    def notice(self, notice, epoch):
        if epoch != self.epoch or notice['task'] != self.task:
            return
        if self.database and notice['database'] != self.database:
            self.pending_database = notice['database']
        self.desired = max(self.desired, notice['seq'])

    def snapshot(self, snap, epoch):
        if epoch != self.epoch or snap['task'] != self.task:
            return False
        if self.database == snap['database'] and snap['seq'] < self.cursor:
            return False
        changed_database = self.database is not None and self.database != snap['database']
        self.database = snap['database']
        self.cursor = snap['seq']
        self.desired = snap['seq'] if changed_database else max(self.desired, snap['seq'])
        self.projection = copy.deepcopy(snap['projection'])
        self.pending_database = None
        return True

    def page(self, page, epoch):
        if epoch != self.epoch or page.get('task') != self.task or page.get('database') != self.database:
            return False
        # Validate the complete page before changing the committed cursor/projection.
        cursor = self.cursor
        p = copy.deepcopy(self.projection)
        for event in page['events']:
            if event['seq'] <= cursor:
                continue
            if event['seq'] != cursor + 1:
                raise Conflict('event gap')
            p = Host.reduce(p, event['body'])
            cursor = event['seq']
        self.cursor, self.projection = cursor, p
        return True

    def reconcile(self, host):
        # Explicit liveness probe; tests call it deterministically, not on a real IPC timer.
        epoch = self.epoch
        self.notice(host.watermark(self.task), epoch)
        if self.pending_database or self.projection is None:
            self.snapshot(host.snapshot(self.task), epoch)
        while self.cursor < self.desired:
            page = host.replay(self.task, self.database, self.cursor, self.desired)
            if page.get('snapshotRequired'):
                self.snapshot(host.snapshot(self.task), epoch)
                break
            if not page['events']:
                raise Conflict('missing replay data')
            self.page(page, epoch)


class DraftView:
    def __init__(self):
        self.epoch = 0
        self.open('A', {'rev': 0, 'text': ''})

    def open(self, task, draft):
        self.epoch += 1
        self.task, self.base, self.text, self.edit = task, draft['rev'], draft['text'], 0

    def type(self, text):
        self.edit += 1
        self.text = text

    def capture(self):
        return {'epoch': self.epoch, 'task': self.task, 'edit': self.edit, 'text': self.text, 'base': self.base}

    def ack(self, sent, receipt):
        if sent['epoch'] != self.epoch or receipt['task'] != self.task or receipt['rev'] < self.base:
            return False
        self.base = receipt['rev']
        if self.edit == sent['edit']:
            self.text = receipt['text']
        return True


def item(name, rev=1, state='streaming', text=None):
    return {'kind': 'item', 'id': name, 'rev': rev, 'state': state, 'text': text or name}


def rejects(fn, message):
    try:
        fn()
    except Conflict as e:
        assert message in str(e), str(e)
    else:
        raise AssertionError('expected rejection: ' + message)


def case(name):
    def decorate(fn):
        with tempfile.TemporaryDirectory(prefix='sync-', dir=ROOT) as tmp:
            host = Host(Path(tmp) / 'state.sqlite')
            host.task('A'); host.task('B')
            other = Host(Path(tmp) / 'state.sqlite')
            try:
                fn(host, other, Path(tmp))
                RESULTS.append({'id': name, 'passed': True})
            except BaseException as e:
                RESULTS.append({'id': name, 'passed': False, 'error': str(e), 'trace': traceback.format_exc()})
            finally:
                host.db.close(); other.db.close()
        return fn
    return decorate


@case('S01-negative-control-nontransactional-snapshot')
def _(h, other, tmp):
    old_seq = h.watermark('A')['seq']
    other.commit('A', item('new'))
    inconsistent = {'seq': old_seq, 'projection': h.snapshot('A')['projection']}
    assert inconsistent['seq'] == 0 and 'new' in inconsistent['projection']['items']


@case('S02-real-WAL-snapshot-is-consistent-with-concurrent-writer')
def _(h, other, tmp):
    snap = h.snapshot('A', lambda: other.commit('A', item('new')))
    assert snap['seq'] == 0 and snap['projection']['items'] == {}
    r = Replica(); r.snapshot(snap, r.epoch); r.reconcile(h)
    assert r.cursor == 1 and 'new' in r.projection['items']


@case('S03-subscribe-snapshot-replay-interleavings')
def _(h, other, tmp):
    r = Replica(); epoch = r.epoch
    h.listeners.append(lambda n: r.notice(n, epoch))
    h.commit('A', item('before'))
    snap = h.snapshot('A')
    h.commit('A', item('during'))
    r.snapshot(snap, epoch); r.reconcile(h)
    h.commit('A', item('after')); r.reconcile(h)
    assert r.cursor == 3 and len(r.projection['items']) == 3


@case('S04-all-notice-permutations-duplicates-coalesce')
def _(h, other, tmp):
    notices = []
    h.listeners.append(notices.append)
    for n in range(4): h.commit('A', item(str(n)))
    for order in itertools.permutations(notices):
        r = Replica(); r.snapshot({'database': h.identity, 'task': 'A', 'seq': 0, 'projection': {'generation': 1, 'items': {}}}, r.epoch)
        for n in order + order: r.notice(n, r.epoch)
        assert r.desired == 4
        r.reconcile(h)
        assert r.cursor == 4 and len(r.projection['items']) == 4


@case('S05-last-notice-loss-negative-control-and-watermark-repair')
def _(h, other, tmp):
    r = Replica(); r.snapshot(h.snapshot('A'), r.epoch)
    h.commit('A', item('lost'), publish=False)
    assert r.cursor == r.desired == 0 and r.projection['items'] == {}
    r.reconcile(h)
    assert r.cursor == 1 and 'lost' in r.projection['items']


@case('S06-old-view-snapshot-page-notice-rejected')
def _(h, other, tmp):
    r = Replica(); old = r.epoch; snap = h.snapshot('A')
    h.commit('A', item('a')); page = h.replay('A', h.identity, 0, 1)
    r.select('B'); r.snapshot(h.snapshot('B'), r.epoch)
    assert not r.snapshot(snap, old) and not r.page(page, old)
    r.notice(h.watermark('A'), old)
    assert r.task == 'B' and r.cursor == r.desired == 0


@case('S07-event-gap-does-not-advance-cursor-or-partial-page')
def _(h, other, tmp):
    r = Replica(); r.snapshot(h.snapshot('A'), r.epoch)
    for n in range(3): h.commit('A', item(str(n)))
    page = h.replay('A', h.identity, 0, 3, 3)
    bad = copy.deepcopy(page); bad['events'].pop(1)
    rejects(lambda: r.page(bad, r.epoch), 'gap')
    assert r.cursor == 0 and r.projection['items'] == {}
    r.reconcile(h); assert r.cursor == 3
    assert r.page(page, r.epoch) and r.cursor == 3


@case('S08-pruned-cursor-falls-back-to-current-projection')
def _(h, other, tmp):
    r = Replica(); r.snapshot(h.snapshot('A'), r.epoch)
    for n in range(4): h.commit('A', item(str(n)))
    h.prune('A', 3); r.reconcile(h)
    assert r.cursor == 4 and len(r.projection['items']) == 4
    assert h.replay('A', h.identity, 3, 4)['events'][0]['seq'] == 4
    assert h.replay('A', h.identity, 99, 99)['snapshotRequired']


@case('S09-new-database-same-task-cannot-reuse-cursor')
def _(h, other, tmp):
    h.commit('A', item('old')); r = Replica(); r.snapshot(h.snapshot('A'), r.epoch)
    fresh = Host(tmp / 'replacement.sqlite')
    try:
        fresh.task('A'); fresh.commit('A', item('new'))
        old_page = h.replay('A', h.identity, 0, 1)
        r.reconcile(fresh)
        assert r.database == fresh.identity and 'old' not in r.projection['items']
        assert not r.page(old_page, r.epoch)
    finally: fresh.db.close()


@case('S10-host-reopen-replays-committed-but-unpublished-event')
def _(h, other, tmp):
    r = Replica(); r.snapshot(h.snapshot('A'), r.epoch)
    h.commit('A', item('durable'), publish=False)
    reopened = Host(tmp / 'state.sqlite')
    try:
        assert reopened.identity == h.identity
        r.reconcile(reopened); assert r.cursor == 1
    finally: reopened.db.close()


@case('S11-rollback-does-not-publish-or-leave-sequence-hole')
def _(h, other, tmp):
    notices = []; h.listeners.append(notices.append)
    rejects(lambda: h.commit('A', item('broken'), fail=True), 'injected')
    assert h.snapshot('A')['seq'] == 0 and notices == []
    assert h.commit('A', item('good')) == 1


@case('S12-old-runtime-generation-and-terminal-regression-rejected')
def _(h, other, tmp):
    h.commit('A', item('a', state='done'), generation=1)
    rejects(lambda: h.commit('A', item('a', 2), generation=1), 'regression')
    h.commit('A', {'kind': 'generation', 'generation': 2})
    rejects(lambda: h.commit('A', item('b'), generation=1), 'generation')
    assert h.snapshot('A')['seq'] == 2


@case('S13-unknown-required-event-blocks-without-cursor-advance')
def _(h, other, tmp):
    r = Replica(); r.snapshot(h.snapshot('A'), r.epoch)
    page = {'database': h.identity, 'task': 'A', 'events': [{'seq': 1, 'body': {'kind': 'future-control'}}]}
    rejects(lambda: r.page(page, r.epoch), 'unknown required')
    assert r.cursor == 0


@case('S14-old-snapshot-cannot-overwrite-new-live-state')
def _(h, other, tmp):
    r = Replica(); old = h.snapshot('A'); r.snapshot(old, r.epoch)
    h.commit('A', item('now')); r.reconcile(h)
    assert not r.snapshot(old, r.epoch) and r.cursor == 1


@case('D01-draft-CAS-between-independent-connections')
def _(h, other, tmp):
    h.command('A', 'save1', 'save', 0, '中文初稿')
    rejects(lambda: other.command('A', 'save2', 'save', 0, '旧窗口'), 'CAS')
    assert h.draft('A')['text'] == '中文初稿'


@case('D02-send-ACK-keeps-new-local-edit-and-advances-base')
def _(h, other, tmp):
    h.command('A', 'save', 'save', 0, '第一条')
    v = DraftView(); v.open('A', h.draft('A')); sent = v.capture()
    receipt = h.command('A', 'send', 'send', 1, '第一条', 1)
    v.type('第二条'); v.ack(sent, receipt)
    assert v.text == '第二条' and v.base == 2
    h.command('A', 'save-next', 'save', v.base, v.text)
    assert h.draft('A')['text'] == '第二条'


@case('D03-old-task-ACK-does-not-touch-new-view')
def _(h, other, tmp):
    v = DraftView(); sent = v.capture(); receipt = h.command('A', 'save', 'save', 0, 'a')
    v.open('B', h.draft('B')); v.type('B draft')
    assert not v.ack(sent, receipt) and v.text == 'B draft' and v.base == 0


@case('D04-lost-send-ACK-retry-is-one-outbox-and-key-conflict-rejects')
def _(h, other, tmp):
    h.command('A', 'save', 'save', 0, 'body')
    one = h.command('A', 'send', 'send', 1, 'body', 1)
    two = other.command('A', 'send', 'send', 1, 'body', 1)
    assert one == two and h.db.execute('SELECT count(*) FROM outbox').fetchone()[0] == 1
    rejects(lambda: h.command('A', 'send', 'send', 1, 'changed', 1), 'different')


@case('D05-selection-change-rejects-reference-and-send-preserves-draft')
def _(h, other, tmp):
    h.command('A', 'save', 'save', 0, 'keep')
    h.db.execute('UPDATE drafts SET selection=2 WHERE task=?', ('A',))
    for kind in ('insert', 'send'):
        rejects(lambda: h.command('A', kind, kind, 1, 'keep', 1), 'selection')
    assert h.draft('A')['text'] == 'keep' and h.draft('A')['rev'] == 1
    assert h.db.execute('SELECT count(*) FROM outbox').fetchone()[0] == 0


@case('D06-reference-idempotence-is-insertion-only')
def _(h, other, tmp):
    receipt = h.command('A', 'ref', 'insert', 0, '[a.ts]', 1)
    assert h.command('A', 'ref', 'insert', 0, '[a.ts]', 1) == receipt
    assert h.draft('A')['text'] == '[a.ts]'
    assert h.db.execute('SELECT count(*) FROM outbox').fetchone()[0] == 0


@case('D07-create-first-message-retry-does-not-create-or-send-twice')
def _(h, other, tmp):
    first = h.create_first('creation-1', 'first')
    assert other.create_first('creation-1', 'first') == first
    assert h.db.execute('SELECT count(*) FROM outbox WHERE task=?', (first,)).fetchone()[0] == 1
    assert h.db.execute('SELECT count(*) FROM tasks').fetchone()[0] == 3
    rejects(lambda: other.create_first('creation-1', 'changed'), 'reused')


@case('D08-draft-outbox-receipt-rollback-together')
def _(h, other, tmp):
    h.command('A', 'save', 'save', 0, 'body')
    rejects(lambda: h.command('A', 'send', 'send', 1, 'body', 1, fail=True), 'injected')
    assert h.draft('A')['text'] == 'body' and h.draft('A')['rev'] == 1
    assert h.db.execute('SELECT count(*) FROM outbox').fetchone()[0] == 0
    assert h.db.execute('SELECT count(*) FROM receipts WHERE op=?', ('send',)).fetchone()[0] == 0


@case('D09-stale-save-ACK-does-not-regress-new-ACK')
def _(h, other, tmp):
    v = DraftView(); v.type('one'); s1 = v.capture(); a1 = h.command('A', 's1', 'save', 0, 'one')
    v.ack(s1, a1); v.type('two'); s2 = v.capture(); a2 = h.command('A', 's2', 'save', 1, 'two')
    v.ack(s2, a2); assert not v.ack(s1, a1)
    assert v.text == 'two' and v.base == 2


@case('S15-old-database-snapshot-after-reconnect-is-rejected')
def _(h, other, tmp):
    h.commit('A', item('old')); r = Replica(); old_epoch = r.epoch; old_snapshot = h.snapshot('A')
    r.snapshot(old_snapshot, old_epoch)
    fresh = Host(tmp / 'new-host.sqlite')
    try:
        fresh.task('A'); fresh.commit('A', item('new')); r.reconcile(fresh)
        assert not r.snapshot(old_snapshot, old_epoch)
        assert r.database == fresh.identity and 'new' in r.projection['items']
    finally: fresh.db.close()


@case('S16-future-cache-cursor-resets-view-epoch-before-snapshot')
def _(h, other, tmp):
    r = Replica(); old_epoch = r.epoch; current = h.snapshot('A')
    # A bad persisted cache is untrusted; the authoritative head remains zero.
    r.snapshot({**current, 'seq': 50, 'projection': {'generation': 9, 'items': {}}}, old_epoch)
    r.reconcile(h)
    assert r.cursor == 0 and r.projection['generation'] == 1 and r.epoch != old_epoch


report = {'scope': 'Candidate protocol, real isolated SQLite/WAL, deterministic fake transport. Not actual T3 runtime or WillYou IPC/UI/SDK integration.',
          'sqlite': sqlite3.sqlite_version, 'results': RESULTS}
(ROOT / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'passed': sum(x['passed'] for x in RESULTS), 'total': len(RESULTS), 'failures': [x for x in RESULTS if not x['passed']]}, ensure_ascii=False))
raise SystemExit(0 if all(x['passed'] for x in RESULTS) else 1)
