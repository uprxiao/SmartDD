import {it,expect} from 'vitest';
import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {bundledMigrations,planMigrations,runMigrations} from './migrations';
it('A42 actual old isolated app backup is readable and a failed migration on its independent disk clone is atomic',()=>{
 const source='/private/tmp/willyou-m16-schedule-app-US7kWL/migration-qRwq6b/old-0040-before-migration.db';
 expect(realpathSync(source)).toBe(source);const sha=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
 const frozen=sha(readFileSync(source));expect(frozen).toBe('de2d935697e62ab8feb9abe2fbbc666013600447f2bcc5acd49777a3f48b2a2b');
 const original=new Database(source,{readonly:true,fileMustExist:true});const dir=mkdtempSync('/private/tmp/m16-a42-migration-clone-');copyFileSync(source,dir+'/copy.db');const clone=new Database(dir+'/copy.db');
 try{
  expect(original.pragma('integrity_check',{simple:true})).toBe('ok');const migrations=bundledMigrations();expect(planMigrations(original,migrations).pending.map(m=>m.tag)).toEqual(['0041_rare_skrulls']);
  const tables=['projects','project_dirs','ai_providers','ai_profiles','tasks','agent_tasks','agent_turns','agent_items','app_settings','__drizzle_migrations'];
  const digest=(db:Database.Database)=>sha(JSON.stringify(tables.map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())));
  const unchanged=digest(original);expect(digest(clone)).toBe(unchanged);
  expect(()=>runMigrations(clone,migrations,{recordCommit:()=>{throw new Error('private A42 migration receipt fault');}})).toThrow(/private A42/);
  expect(digest(clone)).toBe(unchanged);expect(planMigrations(clone,migrations).pending.map(m=>m.tag)).toEqual(['0041_rare_skrulls']);
  expect(clone.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='schedule_plans'").get()).toEqual({n:0});expect(runMigrations(clone,migrations)).toEqual(['0041_rare_skrulls']);
  expect(clone.pragma('integrity_check',{simple:true})).toBe('ok');expect(clone.pragma('foreign_key_check')).toEqual([]);
  expect(sha(readFileSync(source))).toBe(frozen);expect(digest(original)).toBe(unchanged);
 } finally{clone.close();original.close();rmSync(dir,{recursive:true,force:true});}
});
