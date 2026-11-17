import { expect,it } from 'vitest';
import { existsSync,mkdtempSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { MacProcessIdentityReader } from '../applications/process-identity';
import { ownedWorkspaceCommand } from './owned-command';
const helper=resolve('out/native/willyou-process-identity');
it.skipIf(process.env.M14_LIVE!=='1'||process.platform!=='darwin'||!existsSync(helper))('host jobs prove the real group before writes and drain background/canceled descendants before returning',async()=>{
 const root=mkdtempSync(join(tmpdir(),'m14-owned-command-')),processes=new MacProcessIdentityReader(helper),run=ownedWorkspaceCommand({processes,env:()=>({...process.env as Record<string,string>})});
 try{
  const file=join(root,'pid');const result=await run(root,process.execPath,['-e',`const{spawn}=require('child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},100)'],{stdio:'ignore'});c.unref();require('fs').writeFileSync(process.argv[1],String(c.pid));console.log('done')`,file],5000);
  expect(result.code).toBe(0);expect(result.stdout.trim()).toBe('done');expect(processes.read(Number(readFileSync(file,'utf8')))).toBeNull();
  const abort=new AbortController();const job=run(root,process.execPath,['-e','setInterval(()=>{},100)'],5000,{signal:abort.signal});setTimeout(()=>abort.abort(),100);expect((await job).code).toBe(-1);
  const rejected=await ownedWorkspaceCommand({processes:{read:()=>null,state:()=> 'unknown'},env:()=>({...process.env as Record<string,string>})})(root,process.execPath,['-e',`require('fs').writeFileSync(${JSON.stringify(join(root,'never'))},'bad')`]);expect(rejected.code).toBe(-1);expect(existsSync(join(root,'never'))).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
},15_000);
