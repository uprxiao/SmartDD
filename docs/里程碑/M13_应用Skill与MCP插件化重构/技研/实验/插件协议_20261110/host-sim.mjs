// 模拟宿主：安装校验、子进程运行时、Schema 校验、超时／崩溃恢复、可选 sandbox-exec。只用于技研，不是生产代码。
import {spawn} from 'node:child_process';import http from 'node:http';import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync,mkdirSync,mkdtempSync,writeFileSync,realpathSync,lstatSync,cpSync} from 'node:fs';import {join,resolve,relative,sep} from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const Ajv=require(process.env.AJV_PATH).default;const ajv=new Ajv({allErrors:true,strict:false});
const ID_RE=/^[a-z][a-z0-9-]{0,19}$/;
export function treeHash(dir){const files=[];const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1)){const p=join(d,e.name);if(e.isSymbolicLink())throw new Error('symlink: '+relative(dir,p));e.isDirectory()?walk(p):files.push(p);}};walk(dir);
 const h=createHash('sha256');for(const f of files){h.update(relative(dir,f)+'\0');h.update(createHash('sha256').update(readFileSync(f)).digest('hex')+'\n');}return {hash:h.digest('hex'),files:files.length};}
export function validateManifest(dir){const errs=[];const inside=p=>{const r=resolve(dir,p);return r===dir||r.startsWith(dir+sep)};let m;
 try{m=JSON.parse(readFileSync(join(dir,'.willyou-plugin/plugin.json'),'utf8'))}catch(e){return {ok:false,errs:['manifest unreadable']}}
 if(!ID_RE.test(m.id||''))errs.push('bad id');if(m.hostApi!==1)errs.push('unsupported hostApi '+m.hostApi);
 if(!m.runtime?.entry||!inside(m.runtime.entry))errs.push('runtime entry outside plugin');
 for(const[cid,c]of Object.entries(m.capabilities||{})){if(!cid.startsWith(m.id+'.'))errs.push('capability prefix: '+cid);if(!String(c.permission).startsWith(m.id+'.'))errs.push('permission prefix: '+cid);
  for(const k of ['input','output']){if(!c[k]||!inside(c[k]))errs.push(k+' schema path: '+cid);else try{ajv.compile(JSON.parse(readFileSync(join(dir,c[k]),'utf8')))}catch(e){errs.push(k+' schema invalid: '+cid)}}}
 for(const p of (m.ui?.panels||[]))if(!m.capabilities?.[p.source?.capability])errs.push('panel source unknown: '+p.id);
 return {ok:!errs.length,errs,manifest:m};}
export class PluginProcess{
 constructor(dir,dataDir,{sandboxProfile,timeoutMs=2000}={}){Object.assign(this,{dir,dataDir,sandboxProfile,timeoutMs});this.seq=0;this.pending=new Map();this.starts=0;}
 start(){const entry=join(this.dir,this.m.runtime.entry);mkdirSync(join(this.dataDir,'home'),{recursive:true});mkdirSync(join(this.dataDir,'tmp'),{recursive:true});
  const env={PATH:'/usr/bin:/bin',HOME:join(this.dataDir,'home'),TMPDIR:join(this.dataDir,'tmp'),WILLYOU_PLUGIN_DATA:this.dataDir,WILLYOU_PLUGIN_ID:this.m.id};
  const [cmd,args]=this.sandboxProfile?['/usr/bin/sandbox-exec',['-p',this.sandboxProfile,process.execPath,entry]]:[process.execPath,[entry]];
  this.child=spawn(cmd,args,{cwd:this.dataDir,env,stdio:['pipe','pipe','pipe']});this.starts++;let buf='';const pending=this.pending=new Map();
  this.child.stdout.on('data',b=>{buf+=b;let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+1);let msg;try{msg=JSON.parse(l)}catch{continue}const p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.t);msg.error?p.rej(new Error('plugin: '+msg.error.message)):p.res(msg.result);}}});
  this.child.stderr.on('data',b=>{this.stderr=(this.stderr||'')+b});
  const c=this.child;c.on('exit',(code,sig)=>{if(this.child===c)this.child=null;for(const[id,p]of pending){clearTimeout(p.t);p.rej(new Error(`plugin exited code=${code} sig=${sig}`+(this.stderr?' stderr='+this.stderr.slice(-160):'')));}pending.clear();});}
 async load(){const v=validateManifest(this.dir);if(!v.ok)throw new Error(v.errs.join('; '));this.m=v.manifest;
  this.validators={};for(const[cid,c]of Object.entries(this.m.capabilities))this.validators[cid]={input:ajv.compile(JSON.parse(readFileSync(join(this.dir,c.input),'utf8'))),output:ajv.compile(JSON.parse(readFileSync(join(this.dir,c.output),'utf8')))};}
 call(method,params){if(!this.child)this.start();const id=++this.seq;const pending=this.pending;return new Promise((res,rej)=>{const t=setTimeout(()=>{pending.delete(id);this.child?.kill('SIGKILL');this.child=null;rej(new Error('timeout '+this.timeoutMs+'ms, killed'));},this.timeoutMs);pending.set(id,{res,rej,t});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
 async execute(cid,input,connection){const v=this.validators[cid];if(!v)throw new Error('host: unknown capability');if(!v.input(input))throw new Error('host: input rejected '+ajv.errorsText(v.input.errors));
  const out=await this.call('execute',{capability:cid,input,connection});if(!v.output(out))throw new Error('host: output rejected '+ajv.errorsText(v.output.errors));return out;}
 stop(){this.child?.kill('SIGTERM');}}
