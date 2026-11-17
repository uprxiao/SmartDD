// Runs outside the Electron UI thread. Snapshot bytes are never passed through Git clean filters.
import { parentPort,workerData } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { createHash,randomUUID } from 'node:crypto';
import { promises as fs,constants,createWriteStream } from 'node:fs';
import { join,resolve,relative,dirname,isAbsolute } from 'node:path';
import { createDeflate } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
export interface DiffJob { action:'capture'|'changes'|'patch'|'release'|'collect';cwd:string;storage:string;turnId:string;side?:'before'|'after';before?:TreeRef;after?:TreeRef;path?:string;excluded?:string[];timeoutMs?:number;limits?:{files?:number;bytes?:number;storage?:number;reserve?:number} }
export interface TreeRef {cwd:string;dev:string;ino:string;gitDir:string;workTree:string;ref:string;commit:string;tree:string;private:boolean}
const inside=(root:string,path:string)=>{const p=relative(root,path);return !p||!isAbsolute(p)&&p!=='..'&&!p.startsWith('../');};
const commandBudgets=new WeakMap<object,number>();const commandSignals=new WeakMap<object,AbortSignal>();
export interface DiffControl {signal?:AbortSignal;progress?(value:{files:number;bytes:number}):void}
async function command(cwd:string,args:string[],env:NodeJS.ProcessEnv,input?:Buffer):Promise<Buffer>{return new Promise((ok,no)=>{const p=spawn('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null',...args],{cwd,env,stdio:['pipe','pipe','pipe']});const signal=commandSignals.get(env);const abort=()=>p.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const out:Buffer[]=[],err:Buffer[]=[];let count=0,failed=false;const timer=setTimeout(()=>{failed=true;p.kill('SIGTERM');},Math.max(1,Math.min(120_000,(commandBudgets.get(env)??Date.now()+120_000)-Date.now())));p.stdout.on('data',(b:Buffer)=>{count+=b.length;if(count>16*1024*1024){failed=true;p.kill('SIGTERM');}else out.push(b);});p.stderr.on('data',(b:Buffer)=>{if(Buffer.concat(err).length<8192)err.push(b);});p.on('error',no);p.on('exit',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);code===0&&!failed&&!signal?.aborted?ok(Buffer.concat(out)):no(Error(Buffer.concat(err).toString().slice(-2000)||'Git 快照命令超时或超限'));});p.stdin.on('error',()=>{});p.stdin.end(input);});}
async function directoryBytes(root:string):Promise<number>{let total=0;for(const e of await fs.readdir(root,{withFileTypes:true})){if(e.isDirectory())total+=await directoryBytes(join(root,e.name));else if(e.isFile())total+=(await fs.stat(join(root,e.name))).size;}return total;}
async function validate(ref:TreeRef,storage:string){const actual=await fs.realpath(ref.cwd),s=await fs.stat(actual);if(actual!==ref.cwd||String(s.dev)!==ref.dev||String(s.ino)!==ref.ino)throw Error('快照目录身份已变化');if(ref.private&&!inside(resolve(storage),await fs.realpath(ref.gitDir)))throw Error('影子库越界');const env={...process.env,GIT_DIR:ref.gitDir,GIT_WORK_TREE:ref.workTree,GIT_OPTIONAL_LOCKS:'0',GIT_CONFIG_NOSYSTEM:'1'};if((await command(actual,['rev-parse','--verify',ref.ref],env)).toString().trim()!==ref.commit)throw Error('快照引用已改变或不可用');return env;}
export async function runDiffJob(job:DiffJob,control:DiffControl={}):Promise<unknown>{
 control.signal?.throwIfAborted();
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(job.turnId))throw Error('回合标识无效');
 const cwd=await fs.realpath(job.cwd),identity=await fs.stat(cwd);if(!identity.isDirectory())throw Error('工作根不可用');
 if(job.action==='collect'){const dir=join(resolve(job.storage),createHash('sha256').update(cwd+':'+identity.dev+':'+identity.ino).digest('hex'));const actual=await fs.realpath(dir);if(actual!==dir||!inside(resolve(job.storage),actual))throw Error('影子库身份已变化');await command(cwd,['--git-dir='+actual,'prune','--expire=now'],{...process.env,GIT_CONFIG_NOSYSTEM:'1'});for(const name of await fs.readdir(resolve(job.storage)))if(name.startsWith('stat-')&&name.endsWith('.json'))await fs.rm(join(resolve(job.storage),name),{force:true});return{collected:true};}
 if(job.action==='release'&&job.before&&!job.after){const env=await validate(job.before,job.storage);await command(cwd,['update-ref','-d',job.before.ref,job.before.commit],env);return{released:true};}
 if(job.action!=='capture'){
  if(!job.before||!job.after||job.before.cwd!==cwd||job.after.cwd!==cwd||job.before.gitDir!==job.after.gitDir)throw Error('差异快照不属于同一工作根');
  const env=await validate(job.before,job.storage);await validate(job.after,job.storage);
  if(job.action==='release'){await command(cwd,['update-ref','-d',job.before.ref,job.before.commit],env);await command(cwd,['update-ref','-d',job.after.ref,job.after.commit],env);return {released:true};}
  const raw=await command(cwd,['diff','--no-ext-diff','--no-textconv','--no-renames','--numstat','-z',job.before.commit,job.after.commit,'--'],env);
  const files=raw.toString('utf8').split('\0').filter(Boolean).map(line=>{const [added,removed,...name]=line.split('\t');return{path:name.join('\t'),added:added==='-'?null:Number(added),removed:removed==='-'?null:Number(removed),binary:added==='-'};});
  if(job.action==='changes')return {files};
  if(!job.path||!files.some(f=>f.path===job.path))throw Error('文件不在本轮差异中');
  const info=files.find(f=>f.path===job.path)!;if(info.binary)return{...info,patch:null,reason:'二进制文件只显示改动元数据'};
  const counts=await command(cwd,['diff','--no-ext-diff','--no-textconv','--no-renames','--numstat',job.before.commit,job.after.commit,'--',job.path],env);if(counts.length>8192||Number(info.added)+Number(info.removed)>10000)return{...info,patch:null,reason:'差异过大，不在面板预览'};
  const patch=await command(cwd,['diff','--no-ext-diff','--no-textconv','--no-renames','--no-color',job.before.commit,job.after.commit,'--',job.path],env);if(patch.length>1024*1024)return {...info,patch:null,reason:'差异超过 1 MiB 预览上限'};
  const body=async(ref:TreeRef)=>{const row=(await command(cwd,['ls-tree','-z',ref.commit,'--',job.path!],env)).toString().split('\0')[0];if(!row)return '';const oid=row.split(/\s+/)[2];const size=Number((await command(cwd,['cat-file','-s',oid],env)).toString());if(!Number.isSafeInteger(size)||size>1024*1024)throw Error('文件超过 1 MiB 差异正文预览上限');return new TextDecoder('utf-8',{fatal:true}).decode(await command(cwd,['cat-file','blob',oid],env));};
  try{return{...info,patch:patch.toString('utf8'),beforeText:await body(job.before),afterText:await body(job.after)};}catch{return{...info,patch:null,reason:'文件过大或不是可解码的 UTF-8 文本，不提供正文预览'};}
 }
 const deadline=Date.now()+(job.timeoutMs??120000);
 const limits={files:20481,bytes:10*1024**3,storage:1024**3,reserve:2*1024**3,...job.limits},storage=resolve(job.storage);await fs.mkdir(storage,{recursive:true,mode:0o700});
 const disk=await fs.statfs(storage);if(disk.bavail*disk.bsize<limits.reserve)throw Error('可用磁盘不足预留 2 GiB，未捕获差异');
 let svn=false;for(let p=cwd;;p=dirname(p)){try{await fs.lstat(join(p,'.svn'));svn=true;break;}catch{}if(dirname(p)===p)break;}
 let gitDir='',workTree=cwd,isPrivate=true;
 const plainEnv={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1'};commandBudgets.set(plainEnv,deadline);if(control.signal)commandSignals.set(plainEnv,control.signal);
 if(!svn)try{workTree=(await command(cwd,['rev-parse','--show-toplevel'],plainEnv)).toString().trim();gitDir=(await command(cwd,['rev-parse','--absolute-git-dir'],plainEnv)).toString().trim();isPrivate=false;}catch{}
 if(isPrivate){workTree=cwd;gitDir=join(storage,createHash('sha256').update(cwd+':'+identity.dev+':'+identity.ino).digest('hex'));try{await fs.access(join(gitDir,'HEAD'));}catch{await command(storage,['init','--bare','-q',gitDir],plainEnv);}}
 const index=join(storage,`index-${job.turnId}-${randomUUID()}`),env={...plainEnv,GIT_DIR:gitDir,GIT_WORK_TREE:workTree,GIT_INDEX_FILE:index,GIT_AUTHOR_NAME:'WillYou',GIT_AUTHOR_EMAIL:'snapshot@willyou.invalid',GIT_COMMITTER_NAME:'WillYou',GIT_COMMITTER_EMAIL:'snapshot@willyou.invalid'};
 commandBudgets.set(env,deadline);if(control.signal)commandSignals.set(env,control.signal);
 let objectBytes=isPrivate?await directoryBytes(gitDir):0;const objects=(await command(cwd,['rev-parse','--git-path','objects'],env)).toString().trim(),objectRoot=isAbsolute(objects)?objects:resolve(cwd,objects),algorithm=(await command(cwd,['rev-parse','--show-object-format'],env)).toString().trim()==='sha256'?'sha256':'sha1';
 const cachePath=join(storage,'stat-'+createHash('sha256').update(cwd+':'+identity.dev+':'+identity.ino+':'+gitDir).digest('hex')+'.json');let cache:Record<string,{stamp:string;oid:string}>={};try{const info=await fs.lstat(cachePath);if(info.isFile()&&!info.isSymbolicLink()&&info.size<16*1024*1024)cache=JSON.parse(await fs.readFile(cachePath,'utf8'));}catch{}const nextCache:typeof cache={};
 let files=0,bytes=0;const entries:string[]=[];const blocked=[storage,...job.excluded??[]].map(p=>resolve(p));
 try{
  await command(cwd,['read-tree','--empty'],env);
  const listingEnv={...env};commandBudgets.set(listingEnv,deadline);if(control.signal)commandSignals.set(listingEnv,control.signal);if(!isPrivate)delete (listingEnv as NodeJS.ProcessEnv).GIT_INDEX_FILE;
  const pathspec=relative(workTree,cwd)||'.',names=(await command(workTree,['ls-files','--cached','--others','--exclude-standard','-z','--',pathspec],listingEnv)).toString('utf8').split('\0').filter(Boolean);
  control.progress?.({files:0,bytes:0});
  for(const name of [...new Set(names)]){
   control.signal?.throwIfAborted();if(files%64===0)control.progress?.({files,bytes});
   if(Date.now()>deadline)throw Error('快照超过本次后台预算，未发布完整引用');
   if(name.split('/').some(x=>x==='.git'||x==='.svn'))continue;const path=resolve(workTree,name);if(!inside(cwd,path)||blocked.some(root=>inside(root,path)))continue;
   let actualParent:string;try{actualParent=await fs.realpath(dirname(path));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}if(!inside(cwd,actualParent))throw Error('文件的目录链接越界，本轮差异不完整');let s;try{s=await fs.lstat(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
   if(!s.isFile()&&!s.isSymbolicLink())continue;if(++files>limits.files||(bytes+=s.size)>limits.bytes)throw Error('文件数量或内容规模超过已验证范围（20481 文件／10 GiB）');
   const mode=s.isSymbolicLink()?'120000':s.mode&0o111?'100755':'100644',stamp=JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs,s.mode,actualParent]),prior=cache[name];
   if(prior&&prior.stamp===stamp&&new RegExp('^[a-f0-9]{'+(algorithm==='sha256'?64:40)+'}$').test(prior.oid)){entries.push(`${mode} ${prior.oid}\t${name}\0`);nextCache[name]=prior;continue;}
   const hash=createHash(algorithm),temp=join(objectRoot,`.willyou-${randomUUID()}`);await fs.mkdir(objectRoot,{recursive:true});let oid='';
   const room=await fs.statfs(objectRoot),compressedLimit=Math.min(limits.storage,room.bavail*room.bsize-limits.reserve);if(compressedLimit<=0)throw Error('快照存储空间不足，保留已完成引用');
   const compressor=()=>{const z=createDeflate();let output=0;z.on('data',(b:Buffer)=>{output+=b.length;if(output>compressedLimit)z.destroy(Error('压缩产物超过存储或磁盘预留预算'));});return z;};
   try{
    if(s.isSymbolicLink()){const content=Buffer.from(await fs.readlink(path)),header=Buffer.from(`blob ${content.length}\0`);hash.update(header).update(content);oid=hash.digest('hex');const z=compressor(),output=createWriteStream(temp,{flags:'wx',mode:0o444});const done=pipeline(z,output);z.end(Buffer.concat([header,content]));await done;}
    else{
     const f=await fs.open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const a=await f.stat();if(a.dev!==s.dev||a.ino!==s.ino||a.size!==s.size)throw Error('文件在捕获时已替换');const header=Buffer.from(`blob ${s.size}\0`);hash.update(header);const z=compressor();z.write(header);await pipeline(f.createReadStream({autoClose:false}),new Transform({transform(b,_enc,cb){if(control.signal?.aborted){cb(Error('差异捕获已取消'));return;}if(Date.now()>deadline){cb(Error('快照超过本次后台预算'));return;}hash.update(b);cb(null,b);}}),z,createWriteStream(temp,{flags:'wx',mode:0o444}));const b=await f.stat();if(await fs.realpath(dirname(path))!==actualParent)throw Error('目录在捕获期间变化');if(a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.ctimeMs!==b.ctimeMs)throw Error('文件在捕获时发生变化，本轮差异不完整');oid=hash.digest('hex');}finally{await f.close();}}
    const size=(await fs.stat(temp)).size,dir=join(objectRoot,oid.slice(0,2)),target=join(dir,oid.slice(2));let exists=false;try{await fs.access(target);exists=true;}catch{}if(!exists&&isPrivate&&objectBytes+size>limits.storage)throw Error('影子库达到 1 GiB 存储预算');await fs.mkdir(dir,{recursive:true});try{await fs.link(temp,target);objectBytes+=size;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}entries.push(`${mode} ${oid}\t${name}\0`);nextCache[name]={stamp,oid};
   }finally{await fs.rm(temp,{force:true});}
   if(files%128===0){const free=await fs.statfs(storage);if(free.bavail*free.bsize<limits.reserve)throw Error('捕获期间磁盘低于预留空间');}
  }
  await command(cwd,['-c','core.quotePath=false','update-index','-z','--index-info'],env,Buffer.from(entries.join('')));
  const tree=(await command(cwd,['write-tree'],env)).toString().trim(),commit=(await command(cwd,['-c','commit.gpgsign=false','commit-tree',tree],env,Buffer.from(`WillYou observed turn ${job.turnId} ${job.side}\n`))).toString().trim(),ref=`refs/willyou/turns/${job.turnId}/${job.side}`;
  const current=await fs.stat(await fs.realpath(job.cwd));if(current.dev!==identity.dev||current.ino!==identity.ino)throw Error('捕获期间工作目录身份已改变');
  if(isPrivate&&await directoryBytes(gitDir)>limits.storage)throw Error('影子库达到 1 GiB 存储预算，未发布本轮引用');
  control.signal?.throwIfAborted();control.progress?.({files,bytes});
  await command(cwd,['update-ref',ref,commit,'0'.repeat(algorithm==='sha256'?64:40)],env);const cacheTemp=cachePath+'.'+randomUUID();try{await fs.writeFile(cacheTemp,JSON.stringify(nextCache),{flag:'wx',mode:0o600});await fs.rename(cacheTemp,cachePath);}finally{await fs.rm(cacheTemp,{force:true});}return{cwd,dev:String(identity.dev),ino:String(identity.ino),gitDir,workTree,ref,commit,tree,private:isPrivate} satisfies TreeRef;
 }finally{await fs.rm(index,{force:true});await fs.rm(index+'.lock',{force:true});}
}
if(parentPort&&workerData?.kind==='willyou-turn-diff-job'){
 const controller=new AbortController(),cancel=(message:unknown)=>{if(message==='cancel')controller.abort(Error('差异捕获已取消'));};parentPort.on('message',cancel);
 void runDiffJob(workerData as DiffJob,{signal:controller.signal,progress:value=>parentPort!.postMessage({progress:value})}).then(value=>parentPort!.postMessage({ok:true,value}),error=>parentPort!.postMessage({ok:false,error:String(error.message??error)})).finally(()=>{parentPort!.off('message',cancel);parentPort!.close();});
}
