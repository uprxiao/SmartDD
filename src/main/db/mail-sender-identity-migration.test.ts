import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import Database from 'better-sqlite3';
import {afterEach,describe,expect,it} from 'vitest';
import {bundledMigrations,runMigrations} from './migrations';
const databases:Database.Database[]=[];
const before=()=>{const db=new Database(':memory:');databases.push(db);const migrations=bundledMigrations(),index=migrations.findIndex(m=>m.tag==='0029_mail_sender_identity');runMigrations(db,migrations.slice(0,index));return{db,migrations,index};};
const columns=(db:Database.Database)=>(db.prepare('PRAGMA table_info(mail_send_intents)').all() as {name:string}[]).map(c=>c.name);
const rollback=readFileSync(resolve('scripts/applications/rollback-m11-sender-identity.sql'),'utf8');
afterEach(()=>{while(databases.length)databases.pop()!.close();});
describe('M11 sender identity upgrade and offline rollback',()=>{
 it('adds only an empty confirmation table and nullable intent binding without changing historical rows',()=>{
  const{db,migrations,index}=before();
  db.prepare("INSERT INTO capability_session_snapshots VALUES('old',2,'original immutable bytes','original-hash','2026-10-01T00:00:00Z','created','active')").run();
  const snapshot=db.prepare('SELECT * FROM capability_session_snapshots').all(),previousColumns=columns(db),ledger=db.prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY id').all();
  expect(runMigrations(db,migrations)).toEqual(['0029_mail_sender_identity']);expect(columns(db)).toEqual([...previousColumns,'sender_identity_hash']);expect(db.prepare('SELECT * FROM mail_sender_confirmations').all()).toEqual([]);expect(db.prepare('SELECT * FROM capability_session_snapshots').all()).toEqual(snapshot);
  db.exec(rollback);expect(columns(db)).toEqual(previousColumns);expect(db.prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY id').all()).toEqual(ledger);expect(db.prepare('SELECT * FROM capability_session_snapshots').all()).toEqual(snapshot);
  expect(runMigrations(db,migrations)).toEqual([migrations[index].tag]);expect(columns(db)).toContain('sender_identity_hash');expect(db.pragma('foreign_key_check')).toEqual([]);
 });
 it('refuses rollback after a later migration and leaves all schema and migration receipts intact',()=>{
  const{db,migrations}=before();runMigrations(db,migrations);const latest=migrations.at(-1)!;db.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)').run('later-migration',latest.when+1);const ledger=db.prepare('SELECT * FROM __drizzle_migrations').all();
  expect(()=>db.exec(rollback)).toThrow(/CHECK/);expect(db.inTransaction).toBe(false);expect(columns(db)).toContain('sender_identity_hash');expect(db.prepare('SELECT * FROM __drizzle_migrations').all()).toEqual(ledger);
 });
});
