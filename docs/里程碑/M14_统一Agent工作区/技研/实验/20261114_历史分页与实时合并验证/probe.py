"""Isolated candidate protocol: SQLite current-state pages + deterministic delivery, no IPC."""
import copy, hashlib, itertools, json, sqlite3, tempfile, traceback
from pathlib import Path
ROOT = Path(__file__).resolve().parent
RESULTS = []
class Conflict(Exception): pass

def ident(item): return (item['source'], item['id'])
def order(item): return (item['ordinal'], item['source'], item['id'])
def canonical(x): return json.dumps(x, sort_keys=True, ensure_ascii=False)

class Host:
    def __init__(self, path):
        self.db=sqlite3.connect(path, isolation_level=None)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''CREATE TABLE IF NOT EXISTS meta(db TEXT PRIMARY KEY, seq INTEGER);
        CREATE TABLE IF NOT EXISTS items(source TEXT,id TEXT,ordinal INTEGER,revision INTEGER,deleted INTEGER,body TEXT,PRIMARY KEY(source,id));
        CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,body TEXT);''')
        self.db.execute("INSERT OR IGNORE INTO meta VALUES ('fixture-database',0)")
    def seq(self): return self.db.execute('SELECT seq FROM meta').fetchone()[0]
    def commit(self, id, text, source='task', deleted=False):
        self.db.execute('BEGIN IMMEDIATE')
        try:
            old=self.db.execute('SELECT body FROM items WHERE source=? AND id=?',(source,id)).fetchone()
            old=json.loads(old[0]) if old else None
            if old and old['deleted']: raise Conflict('deleted ID cannot be reused')
            seq=self.seq()+1
            item=dict(source=source,id=id,ordinal=old['ordinal'] if old else seq,revision=old['revision']+1 if old else 1,deleted=deleted,text=text)
            self.db.execute('INSERT OR REPLACE INTO items VALUES (?,?,?,?,?,?)',(source,id,item['ordinal'],item['revision'],deleted,canonical(item)))
            self.db.execute('INSERT INTO events VALUES (?,?)',(seq,canonical(item)))
            self.db.execute('UPDATE meta SET seq=?',(seq,))
            self.db.execute('COMMIT')
            return item
        except BaseException:
            self.db.execute('ROLLBACK');raise
    def all(self): return [json.loads(r[0]) for r in self.db.execute('SELECT body FROM items ORDER BY ordinal,source,id')]
    def events(self, after): return [dict(seq=s,item=json.loads(b)) for s,b in self.db.execute('SELECT seq,body FROM events WHERE seq>? ORDER BY seq',(after,))]
    def page(self, request, limit=2, interleave=None):
        # Cursor carries scope and immutable keyset boundary, never a row offset.
        cursor=request['cursor']
        if cursor['database']!='fixture-database' or cursor['task']!='task': raise Conflict('cursor scope')
        self.db.execute('BEGIN')
        try:
            seq=self.seq()
            if interleave: interleave()
            before=tuple(cursor['before']) if cursor['before'] else None
            rows=[r for r in self.all() if not r['deleted'] and (before is None or order(r)<before)]
            rows.sort(key=order,reverse=True)
            selected=rows[:limit]
            next_cursor=dict(database='fixture-database',task='task',before=list(order(selected[-1]))) if len(rows)>limit else None
            self.db.execute('COMMIT')
            return dict(scope=request['scope'],requestId=request['id'],cursor=copy.deepcopy(cursor),seq=seq,rows=selected,next=next_cursor)
        except BaseException:
            self.db.execute('ROLLBACK');raise
    def snapshot(self, limit=1):
        self.db.execute('BEGIN')
        try:
            seq=self.seq(); all_rows=[r for r in self.all() if not r['deleted']];rows=all_rows[-limit:]
            cursor=dict(database='fixture-database',task='task',before=list(order(rows[0]))) if rows else None
            self.db.execute('COMMIT');return seq,rows,cursor
        except BaseException:
            self.db.execute('ROLLBACK');raise
    def close(self):
        assert self.db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';self.db.close()

class Client:
    def __init__(self, host):
        self.scope=('fixture-database','task',1,1,1) # database/task/connection/view/history epoch
        self.pending=None;self.serial=0;self.loading=False;self.error=None
        self.anchor=('fixture-visible-item',17);self.draft='unsent local draft'
        self.install(host)
    def install(self,host):
        self.seq,rows,self.cursor=host.snapshot()
        self.rows={ident(r):r for r in rows};self.pending=None;self.loading=False
    def request(self):
        if self.pending or self.cursor is None: raise Conflict('busy or exhausted')
        self.serial+=1
        r=dict(scope=self.scope,id=self.serial,cursor=copy.deepcopy(self.cursor))
        self.pending=r;self.loading=True;return copy.deepcopy(r)
    def replay(self,events):
        rows=copy.deepcopy(self.rows);seq=self.seq
        for event in events:
            if event['seq']<=seq: continue
            if event['seq']!=seq+1: raise Conflict('event gap')
            item=event['item'];old=rows.get(ident(item))
            if old and (item['revision']<old['revision'] or order(item)!=order(old)): raise Conflict('invalid event')
            rows[ident(item)]=copy.deepcopy(item);seq=event['seq']
        self.rows=rows;self.seq=seq
    def merge(self,page):
        if not self.pending or page['scope']!=self.scope or page['requestId']!=self.pending['id'] or page['cursor']!=self.pending['cursor']: return 'stale'
        if page['seq']>self.seq: return 'needs-events'
        if page['next']==page['cursor']: raise Conflict('cursor did not advance')
        rows=copy.deepcopy(self.rows);seen={};before=page['cursor']['before'];previous=None
        for item in page['rows']:
            if not isinstance(item.get('revision'),int) or item['revision']<1 or item.get('deleted') is not False: raise Conflict('invalid row')
            key=ident(item);pos=order(item)
            if before is not None and pos>=tuple(before): raise Conflict('outside page')
            if previous is not None and pos>previous: raise Conflict('unordered page')
            previous=pos
            if key in seen and seen[key]!=item: raise Conflict('conflicting duplicate')
            seen[key]=item
            old=rows.get(key)
            if old:
                if order(old)!=pos: raise Conflict('mutable ordinal')
                if old['revision']==item['revision'] and old!=item: raise Conflict('same revision conflict')
                if old['deleted'] or old['revision']>=item['revision']: continue
            rows[key]=copy.deepcopy(item)
        if page['next'] is not None:
            nxt=page['next']
            if nxt['database']!=self.scope[0] or nxt['task']!=self.scope[1] or not page['rows'] or tuple(nxt['before'])!=order(page['rows'][-1]): raise Conflict('invalid next cursor')
        self.rows=rows;self.cursor=copy.deepcopy(page['next']);self.pending=None;self.loading=False;self.error=None
        return 'merged'
    def fail(self,request,error):
        if request==self.pending and request['scope']==self.scope:
            self.pending=None;self.loading=False;self.error=error;return True
        return False
    def reset(self,host,index=4):
        scope=list(self.scope);scope[index]+=1;self.scope=tuple(scope);self.install(host)
    def visible(self): return sorted((v for v in self.rows.values() if not v['deleted']),key=order)
    def state(self): return copy.deepcopy(self.__dict__)

RUN=Path(tempfile.mkdtemp(prefix='attempt-',dir=ROOT))
def case(name,fn):
    h=Host(RUN/(name+'.sqlite'))
    try:
        for i in range(1,6):h.commit('i'+str(i),'old'+str(i))
        fn(h);RESULTS.append(dict(id=name,passed=True))
    except BaseException as exc:
        RESULTS.append(dict(id=name,passed=False,error=repr(exc)));raise
    finally:h.close()
def rejects(f):
    try:f()
    except Conflict:return
    raise AssertionError('expected conflict')

def negative(h):
    c=Client(h);p=h.page(c.request(),4);h.commit('i2','updated');h.commit('i3','',deleted=True);c.replay(h.events(c.seq))
    naive=dict(c.rows);naive.update({ident(r):r for r in p['rows']})
    assert naive[('task','i2')]['text']=='old2' and not naive[('task','i3')]['deleted']
    assert c.merge(p)=='merged' and c.rows[('task','i2')]['text']=='updated' and c.rows[('task','i3')]['deleted']

def permutations(h):
    # Each database is independent; exercise all delivery orders of page and two notifications.
    for n,delivery in enumerate(itertools.permutations(('page','update','delete'))):
        sub=Host(RUN/('permutation-'+str(n)+'.sqlite'))
        try:
            for i in range(1,6):sub.commit('i'+str(i),'old'+str(i))
            c=Client(sub);p=sub.page(c.request(),4);sub.commit('i2','updated');sub.commit('i3','',deleted=True)
            for msg in delivery:
                if msg=='page': assert c.merge(p)=='merged'
                else:c.replay(sub.events(c.seq)) # notices are hints, contiguous replay is authoritative
            assert c.visible()==[r for r in sub.all() if not r['deleted']]
        finally:sub.close()

def future(h):
    c=Client(h);r=c.request();h.commit('i2','future');p=h.page(r,4);before=c.state()
    assert c.merge(p)=='needs-events' and c.state()==before
    c.replay(h.events(c.seq));assert c.merge(p)=='merged' and c.seq==6 and c.rows[('task','i2')]['text']=='future'

def gap(h):
    c=Client(h);r=c.request();h.commit('i2','new');h.commit('i3','',deleted=True);p=h.page(r,4);before=c.state()
    rejects(lambda:c.replay(h.events(c.seq)[1:]));assert c.state()==before and c.merge(p)=='needs-events'
    c.replay(h.events(c.seq));assert c.merge(p)=='merged' and ('task','i3') not in [ident(v) for v in c.visible()]

def reset(h):
    for idx in (2,3,4):
        c=Client(h);r=c.request();p=h.page(r,4);c.reset(h,idx);new=c.request();before=c.state()
        assert c.merge(p)=='stale' and not c.fail(r,'late error') and c.state()==before
        assert c.merge(h.page(new,4))=='merged'
    c=Client(h);r=c.request();p=h.page(r,4);c.scope=('replacement','task',2,1,1);before=c.state();assert c.merge(p)=='stale' and c.state()==before

def eviction(h):
    c=Client(h);r=c.request();p=h.page(r,4);h.commit('i3','',deleted=True);c.replay(h.events(c.seq))
    broken=copy.deepcopy(c);broken.rows.pop(('task','i3'));assert broken.merge(p)=='merged' and ('task','i3') in [ident(v) for v in broken.visible()]
    c.reset(h);assert c.merge(p)=='stale';new=c.request();assert c.merge(h.page(new,4))=='merged';assert ('task','i3') not in [ident(v) for v in c.visible()]

def keyset(h):
    c=Client(h);r=c.request();p=h.page(r,2);assert c.merge(p)=='merged'; assert [r['id'] for r in p['rows']]==['i4','i3']
    h.commit('i3','',deleted=True);h.commit('i6','new tail');c.replay(h.events(c.seq));p2=h.page(c.request(),2);assert [r['id'] for r in p2['rows']]==['i2','i1'];assert c.merge(p2)=='merged'
    assert c.visible()==[r for r in h.all() if not r['deleted']] and c.seq==7

def wal(h):
    c=Client(h);r=c.request();second=Host(RUN/'H08-wal.sqlite')
    try:p=h.page(r,4,lambda:second.commit('i2','concurrent'))
    finally:second.close()
    assert p['seq']==5 and next(x for x in p['rows'] if x['id']=='i2')['text']=='old2'
    c.replay(h.events(c.seq));assert c.merge(p)=='merged' and c.rows[('task','i2')]['text']=='concurrent'

def atomic(h):
    c=Client(h);p=h.page(c.request(),4);c.replay(h.events(c.seq));bad=copy.deepcopy(p);bad['rows'][-1]['revision']=0;before=c.state()
    rejects(lambda:c.merge(bad));assert c.state()==before;assert c.merge(p)=='merged'

def duplicate(h):
    c=Client(h);p=h.page(c.request(),4);bad=copy.deepcopy(p);bad['rows'].insert(1,{**bad['rows'][0],'text':'conflict'});before=c.state();rejects(lambda:c.merge(bad));assert c.state()==before
    p['rows'].insert(1,copy.deepcopy(p['rows'][0]));assert c.merge(p)=='merged' and len(c.visible())==5
    before=c.state();assert c.merge(p)=='stale' and c.state()==before

def empty(h):
    c=Client(h);r=c.request()
    for i in range(1,5):h.commit('i'+str(i),'',deleted=True)
    p=h.page(r,4);assert p['rows']==[] and p['next'] is None;c.replay(h.events(c.seq));assert c.merge(p)=='merged' and c.cursor is None and len(c.visible())==1

def badcursor(h):
    c=Client(h);r=c.request();p=h.page(r);bad=copy.deepcopy(p);bad['next']=bad['cursor'];before=c.state();rejects(lambda:c.merge(bad));assert c.state()==before
    wrong=copy.deepcopy(r);wrong['cursor']['task']='other';rejects(lambda:h.page(wrong))
    bad=copy.deepcopy(p);bad['next']['task']='other';rejects(lambda:c.merge(bad));assert c.state()==before

def bounded(h):
    c=Client(h);p=h.page(c.request(),4);assert c.merge(p)=='merged';assert len(c.visible())==5
    # Bounded snapshot absence is not an item deletion; explicit reset invalidates pages/cache.
    h.commit('i5','latest');c.replay(h.events(c.seq));assert len(c.visible())==5
    assert c.anchor==('fixture-visible-item',17) and c.draft=='unsent local draft'
    c.reset(h);assert c.anchor==('fixture-visible-item',17) and c.draft=='unsent local draft'

def idreuse(h):
    c=Client(h);r=c.request();h.commit('i2','',deleted=True);seq=h.seq();rejects(lambda:h.commit('i2','reused'));assert h.seq()==seq
    h.commit('i2','different source',source='child');c.replay(h.events(c.seq));assert c.rows[('task','i2')]['deleted'] and c.rows[('child','i2')]['text']=='different source'

def revision(h):
    c=Client(h);p=h.page(c.request(),4);h.commit('i2','new');c.replay(h.events(c.seq))
    bad=copy.deepcopy(p);item=next(i for i in bad['rows'] if i['id']=='i2');item['revision']=2;before=c.state();rejects(lambda:c.merge(bad));assert c.state()==before
    assert c.merge(p)=='merged'

def between(h):
    c=Client(h);p=h.page(c.request(),4)
    h.commit('i2','updated before page');c.replay(h.events(c.seq))
    assert c.merge(p)=='merged' and c.rows[('task','i2')]['text']=='updated before page'
    h.commit('i3','',deleted=True);c.replay(h.events(c.seq))
    assert c.visible()==[r for r in h.all() if not r['deleted']]

try:
    for name,fn in [('H01-naive-overwrite-negative',negative),('H02-six-delivery-permutations',permutations),('H03-future-page-requires-replay',future),('H04-gap-blocks-page',gap),('H05-stale-scope-and-error',reset),('H06-eviction-negative-and-reset',eviction),('H07-keyset-delete-and-insert',keyset),('H08-wal',wal),('H09-invalid-page-atomic',atomic),('H10-duplicates-and-retry',duplicate),('H11-empty-page-after-deletions',empty),('H12-invalid-and-looping-cursor',badcursor),('H13-bounded-cache-and-anchor-metadata',bounded),('H14-deleted-id-reservation',idreuse),('H15-equal-revision-conflict',revision),('H16-page-between-two-commits',between)]:case(name,fn)
except BaseException:traceback.print_exc()
finally:
    report=dict(scope='Candidate Python protocol, actual isolated SQLite/WAL, synthetic transport and data. No real IPC/UI, no native runtime.',attempt=RUN.name,sqlite=sqlite3.sqlite_version,results=RESULTS,sourceSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    (RUN/'result.json').write_text(json.dumps(report,indent=2));(ROOT/'result.json').write_text(json.dumps(report,indent=2));(RUN/'probe.py').write_bytes(Path(__file__).read_bytes())
    print(json.dumps(dict(attempt=RUN.name,passed=sum(x['passed'] for x in RESULTS),total=len(RESULTS))))
    if len(RESULTS)!=16 or not all(x['passed'] for x in RESULTS):raise SystemExit(1)
