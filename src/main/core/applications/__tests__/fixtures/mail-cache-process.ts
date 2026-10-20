/** Private test child: actual SQLite/files and native kernel identity, synthetic source bytes only. */
import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MailCache } from '../../mail-cache';
import { ResourceStore } from '../../resource-store';
import { MacProcessIdentityReader } from '../../process-identity';
import { digest } from '../../manifest';
const [root,native,raw]=process.argv.slice(2),settings=JSON.parse(raw);
const sqlite=new Database(join(root,'state.sqlite'));
const waiters=new Map<string,()=>void>();let cache:MailCache;
const send=(value:unknown)=>process.send?.(value);
async function main(){
 cache=await MailCache.open(new ResourceStore(sqlite,root),new MacProcessIdentityReader(native),{...settings.limits,checkpoint:async(phase,id)=>{
  send({kind:'phase',phase,id,usage:await cache.usage()});if(settings.hold===phase)await new Promise<void>(resolve=>waiters.set(id,resolve));
 }});
 send({kind:'ready',host:cache.host});
 process.on('message',async(raw)=>{
  const input=raw as {id:string;action:string;source?:string;size?:number;fill?:number;ref?:never;gate?:string};
  try{
   let result:unknown;
   if(input.action==='release'){for(const resolve of waiters.values())resolve();waiters.clear();result=true;}
   else if(input.action==='put')result=await cache.put(digest(input.source!),Buffer.alloc(input.size!,input.fill??1));
   else if(input.action==='lease')result=await cache.withRead(input.ref!,async bytes=>{send({kind:'leased',bytes:bytes.length});await new Promise<void>(resolve=>waiters.set(input.id,resolve));return bytes.length;});
   else if(input.action==='recover'){await cache.recover();result=await cache.usage();}
   else if(input.action==='journal'){
    const source=digest('journal-source');for(let n=0;n<5;n++)await cache.putRecord(source,'journal-'+n,{value:'a'.repeat(80000)},[]);
    await cache.dispose();sqlite.loadExtension(settings.vfs);
    cache=await MailCache.open(new ResourceStore(sqlite,root),new MacProcessIdentityReader(native),settings.limits);
    const index=(cache as unknown as {db:Database.Database}).db;writeFileSync(input.gate!+'.armed','private fault gate');
    index.transaction(()=>{
     for(const row of index.prepare('SELECT record_id,payload_json FROM cache_records').all() as {record_id:string;payload_json:string}[])index.prepare('UPDATE cache_records SET payload_json=? WHERE record_id=?').run(row.payload_json.replaceAll('a','b'),row.record_id);
    }).immediate();result=true;
   }else if(input.action==='dispose'){await cache.dispose();sqlite.close();send({kind:'reply',id:input.id,result:true});process.disconnect?.();return;}
   else throw new Error('unknown private fixture command');
   send({kind:'reply',id:input.id,result});
  }catch(error){send({kind:'reply',id:input.id,error:{code:(error as {code?:string}).code??'FIXTURE_ERROR',message:(error as Error).message}});}
 });
}
main().catch(error=>{send({kind:'startup-error',code:error.code,message:error.message});process.exitCode=1;process.disconnect?.();});
