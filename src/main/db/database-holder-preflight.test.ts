import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,realpathSync,rmSync,writeFileSync,symlinkSync,mkdirSync,existsSync,lstatSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {assertNoForeignDatabaseHolders} from './database-holder-preflight';
let root:string,db:Database.Database|undefined;const children:ChildProcess[]=[];
beforeEach(()=>root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-db-holder-'))));
afterEach(async()=>{for(const child of children.splice(0))if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}db?.close();db=undefined;rmSync(root,{recursive:true,force:true});});
describe.skipIf(process.platform!=='darwin')('legacy database descriptor preflight',()=>{
 it('permits only the current host database and WAL descriptors',async()=>{
  const file=join(root,'live.db');db=new Database(file);db.pragma('journal_mode=WAL');db.exec('CREATE TABLE business(value)');
  expect(await assertNoForeignDatabaseHolders(file)).toMatchObject({platform:'darwin',foreignPids:[]});
 });
 it('rejects an actual uncooperative child descriptor until its process exits',async()=>{
  const file=join(root,'live.db');db=new Database(file);db.exec('CREATE TABLE business(value)');
  const script=join(root,'holder.cjs');writeFileSync(script,"require('node:fs').openSync(process.argv[2],'r+');process.stdout.write('ready\\n');setInterval(()=>{},1000);");
  const child=spawn(process.execPath,[script,file],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']});children.push(child);
  await new Promise<void>((ok,fail)=>{const timer=setTimeout(()=>fail(new Error('holder timeout')),3000);child.stdout!.once('data',()=>{clearTimeout(timer);ok();});child.once('error',error=>{clearTimeout(timer);fail(error);});});
  await expect(assertNoForeignDatabaseHolders(file)).rejects.toThrow('其他进程');const stopped=once(child,'exit');child.kill('SIGKILL');await stopped;
  expect(await assertNoForeignDatabaseHolders(file)).toMatchObject({foreignPids:[]});
 });
 it('accepts a real case alias of the same non-linked file, as Chromium Cache versus application cache on macOS',async()=>{
  const actual=join(root,'Cache');mkdirSync(actual);const file=join(actual,'index.sqlite');writeFileSync(file,'owned test index');const alias=join(root,'cache','index.sqlite');
  if(existsSync(alias)){expect(lstatSync(alias).ino).toBe(lstatSync(file).ino);expect(await assertNoForeignDatabaseHolders(alias)).toMatchObject({checkedFiles:1,foreignPids:[]});}
  else expect(await assertNoForeignDatabaseHolders(alias)).toMatchObject({checkedFiles:0});
 });
 it('still rejects a symlinked ancestor even when the target is an ordinary unshared file',async()=>{
  const actual=join(root,'actual'),alias=join(root,'alias');mkdirSync(actual);writeFileSync(join(actual,'index.sqlite'),'owned target');symlinkSync(actual,alias);
  await expect(assertNoForeignDatabaseHolders(join(alias,'index.sqlite'))).rejects.toThrow('身份');
 });
 it('does not treat orphaned WAL data as a new empty database',async()=>{
  const file=join(root,'missing.db');writeFileSync(file+'-wal','retained WAL bytes');await expect(assertNoForeignDatabaseHolders(file)).rejects.toThrow('主文件缺失');
 });
 it('rejects symlinked database inputs and handles a genuinely absent initial database',async()=>{
  const target=join(root,'target.db'),link=join(root,'link.db');writeFileSync(target,'retain');symlinkSync(target,link);
  await expect(assertNoForeignDatabaseHolders(link)).rejects.toThrow('身份');expect(await assertNoForeignDatabaseHolders(join(root,'new.db'))).toMatchObject({checkedFiles:0});
 });
});
