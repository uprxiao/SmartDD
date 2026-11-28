# Explicit, reversible synthetic-fixture projection; does not downgrade any database.
from pathlib import Path
import hashlib,json,shutil,sqlite3,sys,subprocess
root=Path('/private/tmp/willyou-m16-f36-migration-inplace-PqjkL6').resolve();data=root/'data';backup=root/'b07-v1-roundtrip-private';old=root/'sealed-old-enriched';candidate=root/'sealed-candidate-written';prior=json.loads((root/'B07-migration-result.json').read_text());t1,t2=(prior['oldEnriched'][k] for k in ('t1','t2'));profiles=sorted({tab['profileId'] for w in prior['candidateWrites']['disk']['workspaces'].values() for tab in w['tabs']});with_project_source=sqlite3.connect((old/'smartdd.db').as_uri()+'?mode=ro&immutable=1',uri=True);project_ids=[with_project_source.execute('SELECT project_id FROM tasks WHERE id=?',(i,)).fetchone()[0] for i in (t1,t2)];with_project_source.close();assert len(set(project_ids))==2;keys=[f'browserWorkspace.v1:{t1}',f'browserWorkspace.v1:{t2}',*(f'browserRecent.v1:{p}' for p in project_ids),'browserProfiles.v1'];assert len(profiles)==2 and all(p.startswith('project-') for p in profiles)
assert data.resolve()==data and all(p.parent==root and p.resolve()==p for p in (data,old,candidate));sha=lambda b:hashlib.sha256(b).hexdigest();dbpath=lambda d:d/'smartdd.db'
def clean(d):
 for suffix in ['-wal','-shm']:
  p=Path(str(dbpath(d))+suffix)
  if suffix=='-wal':assert not p.exists() or p.stat().st_size==0,(d,suffix,'uncheckpointed')
 assert dbpath(d).is_file() and not dbpath(d).is_symlink()
def ro(d):
 clean(d);return sqlite3.connect(dbpath(d).as_uri()+'?mode=ro&immutable=1',uri=True)
def ledger(c):return c.execute('SELECT * FROM __drizzle_migrations ORDER BY id').fetchall()
def scan(d):
 with ro(d) as c:
  l=ledger(c);rows={k:c.execute('SELECT value, updated_at FROM app_settings WHERE key=?',(k,)).fetchone() for k in keys};assert all(rows.values());assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok';return {'schemaCount':len(l),'migrationLedgerSha':sha(json.dumps(l).encode()),'dbSha':sha(dbpath(d).read_bytes()),'rows':{k:sha(v[0].encode()) for k,v in rows.items()}}
def part(d,p):return d/'Partitions'/('wy-browser-'+p)
def manifest(p):
 assert p.is_dir() and not p.is_symlink(); out={}
 for f in p.rglob('*'):
  assert not f.is_symlink(),f
  if f.is_file():out[str(f.relative_to(p))]=sha(f.read_bytes())
 return out
def gates():
 out={}
 for f in [data/'.database-access.sqlite',data/'capabilities/locks/.resource.lock.gate.sqlite']:
  assert f.is_file() and not f.is_symlink();out[str(f.relative_to(data))]={'dev':f.stat().st_dev,'ino':f.stat().st_ino}
 return out
def assert_closed():
 clean(data); r=subprocess.run(['/usr/sbin/lsof','-t',str(dbpath(data))],capture_output=True,text=True);assert r.returncode==1 and not r.stdout.strip(),'live access to isolated database; stop fixture preparation'
def capture(name):
 assert_closed();dest=backup/name;assert not dest.exists();dest.mkdir(mode=0o700);(dest/'Partitions').mkdir();shutil.copy2(dbpath(data),dbpath(dest));
 for p in profiles:shutil.copytree(part(data,p),part(dest,p));
 assert scan(data)==scan(dest);return dest
def replace(src,name):
 assert_closed();target=backup/name;assert not target.exists();target.mkdir(mode=0o700);(target/'Partitions').mkdir();
 for suffix in ['', '-wal','-shm']:
  f=Path(str(dbpath(data))+suffix)
  if f.exists():shutil.move(f,target/f.name)
 shutil.copy2(dbpath(src),dbpath(data));
 for p in profiles:
  a,b=part(src,p),part(data,p);before=manifest(b); expected=manifest(a);shutil.move(b,part(target,p));shutil.copytree(a,b); assert manifest(b)==expected and manifest(part(target,p))==before
 return scan(data)
def project(src):
 assert_closed();srcData=scan(src);before=scan(data)
 with ro(src) as c: rows=[(k,*c.execute('SELECT value, updated_at FROM app_settings WHERE key=?',(k,)).fetchone()) for k in keys]
 with sqlite3.connect(str(dbpath(data))) as c:
  l=ledger(c);assert len(l)==before['schemaCount'];c.executemany('UPDATE app_settings SET value=?, updated_at=? WHERE key=?',[(v,t,k) for k,v,t in rows]);assert c.total_changes==len(keys);assert ledger(c)==l;c.commit();c.execute('PRAGMA wal_checkpoint(TRUNCATE)');assert c.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 after=scan(data);assert after['schemaCount']==before['schemaCount'] and after['migrationLedgerSha']==before['migrationLedgerSha'] and after['rows']==srcData['rows'];return {'source':srcData,'destinationBefore':before,'destinationAfter':after}
mode=sys.argv[1];assert mode in ('prepare-old','prepare-new','restore-original');assert_closed();g=gates();record={'mode':mode,'root':str(root),'profiles':profiles,'keys':keys,'gatesBefore':g,'boundary':'Only own closed synthetic fixture; original per-version DB restored as exact copy; project-owned v1 records projected, associated isolated cookie partitions copied; migration ledger and gate file never edited; not whole-app downgrade or independent F36 standalone product.'}
if mode=='prepare-old':
 assert not backup.exists();assert scan(old)['dbSha']==prior['oldEnrichedDbSha'];assert scan(candidate)['dbSha']==prior['candidateDbSha'];assert scan(old)['schemaCount']==41 and scan(candidate)['schemaCount']==42;backup.mkdir(mode=0o700); original=capture('original-sealed');record['original']=scan(original);record['oldBase']=replace(old,'pre-old-saved');assert record['oldBase']['schemaCount']==41;record['projection']=project(candidate)
 # Replace just the two old fixture partitions with candidate's exact closed data.
 saved=backup/'pre-candidate-partitions';saved.mkdir()
 for p in profiles:
  d=part(data,p);a=part(candidate,p);expected=manifest(a);shutil.move(d,saved/d.name);shutil.copytree(a,d);assert manifest(d)==expected
elif mode=='prepare-new':
 assert backup.is_dir();assert scan(data)['schemaCount']==41;legacy=capture('old-written');record['oldWritten']=scan(legacy);record['candidateBase']=replace(backup/'original-sealed','after-old-before-new');assert record['candidateBase']['schemaCount']==42;record['projection']=project(legacy)
 saved=backup/'pre-old-return-partitions';saved.mkdir()
 for p in profiles:
  d=part(data,p);a=part(legacy,p);expected=manifest(a);shutil.move(d,saved/d.name);shutil.copytree(a,d);assert manifest(d)==expected
else:
 assert backup.is_dir(); original=backup/'original-sealed';assert original.is_dir();record['actualBeforeRestore']=scan(data);record['restored']=replace(original,'after-test-before-original-restore');assert record['restored']==scan(original);record['restoredPartitions']={p:manifest(part(data,p))==manifest(part(original,p)) for p in profiles};assert all(record['restoredPartitions'].values())
record['gatesAfter']=gates();assert g==record['gatesAfter'];(backup/(mode+'.json')).write_text(json.dumps(record,indent=2,ensure_ascii=False)+'\n');print(json.dumps(record,ensure_ascii=False))
