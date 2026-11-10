// 插件 zip 安装校验（技研）：先完整扫描目录再解压；规则沿用资源包标准。
import {createRequire} from 'node:module';import {mkdirSync,createWriteStream,mkdtempSync,realpathSync,writeFileSync} from 'node:fs';import {join,posix} from 'node:path';import {pipeline} from 'node:stream/promises';
import {treeHash,validateManifest} from './host-sim.mjs';
const require=createRequire(import.meta.url);const yauzl=require(process.env.YAUZL_PATH);
const MAX_FILE=64*1024*1024,MAX_TOTAL=256*1024*1024,MAX_ENTRIES=5000;
const open=p=>new Promise((res,rej)=>yauzl.open(p,{lazyEntries:true,autoClose:false,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?rej(e):res(z)));
async function scan(z){const entries=[];let total=0;await new Promise((res,rej)=>{z.on('entry',e=>{
  const n=e.fileName;const mode=(e.externalFileAttributes>>>16)&0o170000;
  if(n.startsWith('/')||/^[A-Za-z]:/.test(n)||n.includes('\\'))return rej(new Error('absolute/backslash path: '+n));
  const norm=posix.normalize(n);if(norm.startsWith('../')||norm==='..'||norm!==n.replace(/\/$/,'')&&!n.endsWith('/'))return rej(new Error('path traversal: '+n));
  if(mode===0o120000)return rej(new Error('symlink entry: '+n));
  if(e.uncompressedSize>MAX_FILE)return rej(new Error('file too large: '+n));total+=e.uncompressedSize;if(total>MAX_TOTAL)return rej(new Error('package too large'));
  if(entries.length>=MAX_ENTRIES)return rej(new Error('too many entries'));entries.push(e);z.readEntry();});z.on('end',res);z.on('error',rej);z.readEntry();});return entries;}
export async function installZip(zipPath,pluginsRoot){const z=await open(zipPath);try{const entries=await scan(z);
  const stage=mkdtempSync(join(pluginsRoot,'.stage-'));
  for(const e of entries){const dest=join(stage,e.fileName);if(e.fileName.endsWith('/')){mkdirSync(dest,{recursive:true});continue;}mkdirSync(join(dest,'..'),{recursive:true});
    const rs=await new Promise((res,rej)=>z.openReadStream(e,(er,s)=>er?rej(er):res(s)));await pipeline(rs,createWriteStream(dest,{flags:'wx',mode:0o644}));}
  const v=validateManifest(stage);if(!v.ok)throw new Error('manifest: '+v.errs.join('; '));return {stage,manifest:v.manifest,hash:treeHash(stage)};}finally{z.close();}}
if(import.meta.url===(await import("node:url")).pathToFileURL(process.argv[1]).href){const [zips,src]=process.argv.slice(2);const root=realpathSync(mkdtempSync('/tmp/m13-zip-'));const out={srcHash:treeHash(src).hash,cases:{}};
 for(const n of ['good','symlink','traversal','absolute','bomb']){try{const r=await installZip(join(zips,n+'.zip'),root);out.cases[n]={ok:true,hash:r.hash.hash,matchesSource:r.hash.hash===out.srcHash,id:r.manifest.id};}catch(e){out.cases[n]={ok:false,error:String(e.message).slice(0,160)};}}
 out.evilWritten=['/tmp/evil-abs',join(root,'..','evil.mjs')].filter(p=>{try{require('node:fs').statSync(p);return true}catch{return false}});
 console.log(JSON.stringify(out,null,1));}
