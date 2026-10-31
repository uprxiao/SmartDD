import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,realpathSync,rmSync,statSync,writeFileSync,readFileSync} from 'node:fs';
import {builtinModules} from 'node:module';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {build as viteBuild} from 'vite';
import {beforeAll,afterAll,beforeEach,afterEach,expect,it} from 'vitest';
import {acquireDatabaseAccess} from './database-access-gate';
let build:string,root:string;const children=new Set<ChildProcess>();
beforeAll(async()=>{build=mkdtempSync(join(tmpdir(),'willyou-db-access-build-'));await viteBuild({configFile:false,publicDir:false,logLevel:'error',ssr:{noExternal:true},build:{ssr:resolve('src/main/db/fixtures/database-access-holder.ts'),target:'node22',outDir:build,emptyOutDir:false,minify:false,rollupOptions:{external:id=>id==='better-sqlite3'||id.startsWith('node:')||builtinModules.includes(id),output:{format:'cjs',entryFileNames:'holder.cjs',inlineDynamicImports:true}}}});});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(()=>root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-db-access-process-'))));
async function kill(child:ChildProcess){if(child.exitCode===null&&child.signalCode===null){const done=once(child,'exit');child.kill('SIGKILL');await done;}}
afterEach(async()=>{await Promise.all([...children].map(kill));children.clear();rmSync(root,{recursive:true,force:true});});
it.each(['shared','maintenance'] as const)('blocks a competing upgrade while %s host lives and releases the same inode after actual SIGKILL',async mode=>{
 writeFileSync(join(root,'business-sentinel'),'unchanged');
 const child=spawn(process.execPath,[join(build,'holder.cjs'),root,mode],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',NODE_PATH:resolve('node_modules')},stdio:['ignore','pipe','pipe']});children.add(child);
 await new Promise<void>((accept,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('holder checkpoint timeout')),4000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',()=>{clearTimeout(timer);reject(new Error('holder exited'));});child.stdout!.on('data',chunk=>{output+=chunk;if(output.includes('\n')){clearTimeout(timer);try{expect(JSON.parse(output.split('\n')[0])).toEqual({pid:child.pid,mode});accept();}catch(e){reject(e);}}});});
 const file=join(root,'.database-access.sqlite'),before=statSync(file);
 await expect(acquireDatabaseAccess(root,'maintenance',{timeoutMs:40})).rejects.toThrow('仍有宿主');
 await kill(child);const next=await acquireDatabaseAccess(root,'maintenance');try{next.assertHeld();expect(statSync(file).ino).toBe(before.ino);expect(readFileSync(join(root,'business-sentinel'),'utf8')).toBe('unchanged');}finally{next.release();}
});
