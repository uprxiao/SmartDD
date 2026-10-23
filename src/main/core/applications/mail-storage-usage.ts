import {constants} from 'node:fs';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import {dirname,isAbsolute,join,parse,relative} from 'node:path';
import type {ResourceStore} from './resource-store';

export interface StorageMeasurement {bytes:number|null;complete:boolean}
export interface MailBusinessUsage {files:StorageMeasurement;sharedDatabase:StorageMeasurement;drafts:number;sends:number}
const unavailable=():StorageMeasurement=>({bytes:null,complete:false});
const same=(a:{dev:number;ino:number},b:{dev:number;ino:number})=>a.dev===b.dev&&a.ino===b.ino;
/** Read only file-length inventory. It never follows links, opens source mail,
 * changes a file or treats missing/partial measurements as zero disk usage. */
export async function measureStorageTree(root:string):Promise<StorageMeasurement>{
 let bytes=0,entries=0;const seen=new Set<string>();
 try{
  if(!isAbsolute(root)||await realpath(root)!==root)throw Error('root');
  async function walk(path:string,depth:number):Promise<void>{
   if(depth>32||++entries>50000)throw Error('bounded');
   const before=await lstat(path);if(before.isSymbolicLink())throw Error('link');
   if(before.isDirectory()){
    const local=relative(root,path);if(await realpath(path)!==path||local==='..'||local.startsWith('../'))throw Error('outside');
    const names=await readdir(path);for(const name of names)await walk(join(path,name),depth+1);
    const after=await lstat(path);if(!after.isDirectory()||!same(before,after)||after.mtimeMs!==before.mtimeMs)throw Error('changed');
   }else if(before.isFile()){
    const key=before.dev+':'+before.ino;
    if(!seen.has(key)){seen.add(key);bytes+=before.size;if(!Number.isSafeInteger(bytes))throw Error('size');}
    const after=await lstat(path);if(!after.isFile()||after.isSymbolicLink()||!same(before,after)||after.size!==before.size)throw Error('changed');
   }else throw Error('special');
  }
  await walk(root,0);return{bytes,complete:true};
 }catch{return unavailable();}
}
async function ownedMailFiles(store:ResourceStore,root:string):Promise<StorageMeasurement>{
 try{
  const expected=join(dirname(store.root),'app-data/mail');if(root!==expected||await realpath(root)!==root)throw Error('root');
  const marker=await open(join(root,'.willyou-mail-owner.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const stat=await marker.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>4096)throw Error('marker');const owner=JSON.parse(await marker.readFile('utf8'));if(owner.schema!==1||owner.storeId!==store.storeId)throw Error('owner');}finally{await marker.close();}
  return measureStorageTree(root);
 }catch{return unavailable();}
}
async function sharedDatabase(store:ResourceStore):Promise<StorageMeasurement>{
 const path=store.sqlite.name;if(!isAbsolute(path)||path===parse(path).root)return unavailable();
 let bytes=0;const seen=new Set<string>();
 try{
  if(await realpath(path)!==path)throw Error('link');
  for(const suffix of ['','-wal','-shm','-journal']){
   let stat;try{stat=await lstat(path+suffix);}catch(error){if(suffix&&(error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;}
   if(!stat.isFile()||stat.isSymbolicLink())throw Error('file');const key=stat.dev+':'+stat.ino;if(!seen.has(key)){seen.add(key);bytes+=stat.size;}
  }
  if(!Number.isSafeInteger(bytes))throw Error('size');return{bytes,complete:true};
 }catch{return unavailable();}
}
export async function mailBusinessUsage(store:ResourceStore,root:string):Promise<MailBusinessUsage>{
 const [files,database]=await Promise.all([ownedMailFiles(store,root),sharedDatabase(store)]);
 return{files,sharedDatabase:database,drafts:(store.sqlite.prepare('SELECT count(*) n FROM mail_drafts').get() as {n:number}).n,sends:(store.sqlite.prepare('SELECT count(*) n FROM mail_send_executions').get() as {n:number}).n};
}
