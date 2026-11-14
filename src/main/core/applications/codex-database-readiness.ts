// Metadata-only observation, never native ownership or launch authority.
// Fixed official0.167.1 migration checksums: SHA384 of upstream UTF-8 SQL bytes.
// The startup caller must bind the roots/files to an exact owned Native process.
import Database from 'better-sqlite3';
import {lstatSync,realpathSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import metadata from './codex-ddl-0.167.1.json';
import {z} from 'zod';
interface Identity {dev:string;ino:string}
const expected=z.object({version:z.literal('0.167.1'),binarySha256:z.string().regex(/^[a-f0-9]{64}$/),checksumAlgorithm:z.string(),databases:z.array(z.object({name:z.string().regex(/^[a-z0-9_]+\.sqlite$/),root:z.enum(['sqlite','logs']),migrationSet:z.string(),eager:z.boolean(),tables:z.record(z.string(),z.array(z.string())),triggers:z.array(z.string()).optional()}).strict()).max(7),migrationSets:z.record(z.string(),z.array(z.object({version:z.number().int().positive(),checksum:z.string().regex(/^[a-f0-9]{96}$/)}).strict()))}).strict().parse(metadata);
interface Entry {name:string;path:string;exists:boolean;readonly:boolean;queryOnly:boolean;snapshotComplete:boolean;identity?:Identity;migrations?:{version:number;success:number;checksum:string}[];tables?:Record<string,string[]>;triggers?:string[];readError?:string}
export interface CodexDdlObservation {status:'pending'|'unsupported'|'ready';scope:string;issue:string|null;database?:string;opened:number;databases:Entry[];roots:{path:string;dev:string;ino:string}[]}
export interface CodexDdlInput {version:string;binarySha256:string;roots:{sqlite:string;logs:string};existedBeforeFork?:Record<string,boolean>;timeoutMs?:number}
const missing=(e:unknown)=>(e as NodeJS.ErrnoException)?.code==='ENOENT';
const identity=(s:{dev:bigint;ino:bigint}):Identity=>({dev:String(s.dev),ino:String(s.ino)});
const same=(a:Identity,b:Identity)=>a.dev===b.dev&&a.ino===b.ino;
const safeStat=(path:string,type:'directory'|'file'):Identity=>{const stat=lstatSync(path,{bigint:true});if(stat.isSymbolicLink()||!(type==='directory'?stat.isDirectory():stat.isFile())||realpathSync(path)!==path)throw Error('unsafe-path');return identity(stat);};
export function readKnownCodexDdl({version,binarySha256,roots,existedBeforeFork={},timeoutMs=10}:CodexDdlInput):CodexDdlObservation{
 const result:CodexDdlObservation={status:'pending',scope:'readonly-metadata-only; no-native-owner-or-launch-authority',issue:null,opened:0,databases:[],roots:[]};
 const fail=(issue:string,database?:string)=>{result.issue=issue;if(database)result.database=database;return result;};
 if(version!==expected.version||binarySha256!==expected.binarySha256){result.status='unsupported';return fail('unknown-native-version-or-image');}
 if(!roots||!(['sqlite','logs'] as const).every(key=>typeof roots[key]==='string'&&isAbsolute(roots[key]))){result.status='unsupported';return fail('host-resolved-roots-required');}
 const rootProof=new Map<string,Identity>(),fileProof:[string,Identity][]=[],absentProof:string[]=[];let rootFailure:string|undefined;
 try{for(const path of new Set([roots.sqlite,roots.logs]))rootProof.set(path,safeStat(path,'directory'));}catch(error){rootFailure=missing(error)?'root-not-created':'unsafe-or-unreadable-root';}
 if(rootFailure)return fail(rootFailure);
 const recheck=()=>{
  for(const[path,id]of rootProof)if(!same(id,safeStat(path,'directory')))throw Error('root-identity-changed');
  for(const[path,id]of fileProof)if(!same(id,safeStat(path,'file')))throw Error('database-identity-changed');
  for(const path of absentProof){try{lstatSync(path);}catch(error){if(missing(error))continue;throw error;}throw Error('absent-database-appeared');}
 };
 try{
  for(const spec of expected.databases){
   const path=join(roots[spec.root],spec.name),entry:Entry={name:spec.name,path,exists:false,readonly:false,queryOnly:false,snapshotComplete:false};result.databases.push(entry);
   let stat;try{stat=safeStat(path,'file');}catch(error){if(missing(error)){absentProof.push(path);if(spec.eager||existedBeforeFork[spec.name])return fail('pending-db',spec.name);continue;}return fail('unsafe-or-unreadable-db',spec.name);}
   entry.exists=true;entry.identity=stat;fileProof.push([path,stat]);
   let db:Database.Database|undefined;
   try{
    db=new Database(path,{readonly:true,fileMustExist:true,timeout:Math.max(0,Math.min(100,Number.isFinite(timeoutMs)?Math.trunc(timeoutMs):10))});result.opened++;
    entry.readonly=db.readonly;db.pragma('query_only = ON');entry.queryOnly=db.pragma('query_only',{simple:true})===1;
    if(!entry.readonly||!entry.queryOnly)throw Error('not-readonly');
    db.exec('BEGIN');
    const wanted=expected.migrationSets[spec.migrationSet];
    const rows=db.prepare('SELECT version,success,lower(hex(checksum)) AS checksum FROM _sqlx_migrations ORDER BY version LIMIT ?').all(wanted.length+1) as {version:number;success:number;checksum:string}[];
    entry.migrations=rows;
    const columns:Record<string,string[]>={};for(const table of Object.keys(spec.tables))columns[table]=db.prepare('SELECT name FROM pragma_table_xinfo(?)').all(table).map(row=>(row as {name:string}).name);
    entry.tables=columns;
    entry.triggers=spec.triggers?.length?db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN ("+spec.triggers.map(()=>'?').join(',')+") ORDER BY name").all(...spec.triggers).map(row=>(row as {name:string}).name):[];
    db.exec('COMMIT');entry.snapshotComplete=true;
    if(rows.length!==wanted.length)return fail('migration-set-incomplete-or-newer',spec.name);
    const versions=new Map(rows.map(row=>[row.version,row]));if(versions.size!==rows.length)return fail('duplicate-migration',spec.name);
    for(const item of wanted){const actual=versions.get(item.version);if(!actual||actual.success!==1||actual.checksum!==item.checksum)return fail('migration-not-committed-or-mismatch',spec.name);}
    for(const[table,required]of Object.entries(spec.tables))if(required.some(name=>!columns[table].includes(name)))return fail('schema-incomplete',spec.name);
    if((spec.triggers??[]).some(name=>!(entry.triggers??[]).includes(name)))return fail('triggers-incomplete',spec.name);
   }catch(error){entry.readError=typeof (error as NodeJS.ErrnoException)?.code==='string'?(error as NodeJS.ErrnoException).code:'metadata-read-error';return fail('unreadable-db',spec.name);}
   finally{if(db){if(db.inTransaction)try{db.exec('ROLLBACK');}catch{}db.close();}}
  }
  recheck();result.roots=[...rootProof].map(([path,id])=>({path,...id}));result.status='ready';result.issue=null;return result;
 }catch{return fail('root-or-file-identity-changed');}
 finally{
  // Every pending observation is also checked. Failure remains non-ready.
  try{recheck();}catch{result.status='pending';result.issue='root-or-file-identity-changed';}
 }
}
