import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {lstat,realpath} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

const execute=promisify(execFile);
async function inspectFile(path:string){
 const stat=await lstat(path);
 const invalid=()=>new Error('数据库文件身份不能核验');
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw invalid();
 const canonical=await realpath(path);
 if(canonical!==path){
  // APFS can return the on-disk spelling (Chromium's Cache) for our
  // non-linked cache path. Prove identity; never authorize by lowercasing.
  const target=await lstat(canonical);
  if(!target.isFile()||target.isSymbolicLink()||target.nlink!==1||target.dev!==stat.dev||target.ino!==stat.ino)throw invalid();
  for(let parent=dirname(path);;parent=dirname(parent)){
   const entry=await lstat(parent);if(!entry.isDirectory()||entry.isSymbolicLink())throw invalid();
   if(parent===dirname(parent))break;
  }
 }
 return stat;
}
/** Additional macOS observation for hosts predating the cooperative access gate.
 * This is a point-in-time preflight, not an OS-wide exclusion lock. Call again
 * after backup, under the new host's maintenance lease, before committing. */
export async function assertNoForeignDatabaseHolders(databasePath:string):Promise<{platform:'darwin';checkedFiles:number;foreignPids:number[]}>{
 if(process.platform!=='darwin')throw new Error('当前平台尚未验证旧宿主数据库占用检查');
 const file=resolve(databasePath),files:{path:string;dev:number;ino:number}[]=[];
 for(const path of [file,file+'-wal',file+'-shm']){
  try{
   const stat=await inspectFile(path);
   files.push({path,dev:stat.dev,ino:stat.ino});
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 }
 if(!files.length)return{platform:'darwin',checkedFiles:0,foreignPids:[]};
 if(!files.some(item=>item.path===file))throw new Error('数据库主文件缺失但仍有旁文件，保留原数据并停止初始化');
 let output:string;
 try{
  const result=await execute('/usr/sbin/lsof',['-t','--',...files.map(f=>f.path)],{encoding:'utf8',timeout:5000,maxBuffer:128*1024});
  if(result.stderr.trim())throw new Error('数据库占用检查未完整返回');output=result.stdout;
 }catch(error){
  const failure=error as {code?:unknown;stdout?:string;stderr?:string;killed?:boolean};
  if(failure.code===1&&!failure.killed&&!failure.stdout?.trim()&&!failure.stderr?.trim())output='';
  else throw new Error('无法核验旧宿主数据库占用，保留原库并停止迁移');
 }
 const lines=output.trim()?output.trim().split('\n'):[];
 if(lines.some(line=>! /^[1-9][0-9]*$/.test(line)||!Number.isSafeInteger(Number(line))))throw new Error('数据库占用结果格式无法核验');
 for(const prior of files){const current=await inspectFile(prior.path);if(current.dev!==prior.dev||current.ino!==prior.ino)throw new Error('数据库文件在占用检查期间变化');}
 const foreignPids=[...new Set(lines.map(Number))].filter(pid=>pid!==process.pid).sort((a,b)=>a-b);
 if(foreignPids.length)throw new Error('其他进程仍打开此数据库，请先结束相关宿主后再迁移');
 return{platform:'darwin',checkedFiles:files.length,foreignPids};
}
