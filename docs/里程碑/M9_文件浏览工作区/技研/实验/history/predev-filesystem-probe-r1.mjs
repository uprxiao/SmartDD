// Independent real-disk/RG feasibility probe. No production file service is installed.
import fs from 'node:fs/promises';
import sync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const output = process.argv[2];
if (!output || sync.existsSync(output)) throw Error('Provide a NEW output path; historical reports are immutable');
const EXCLUDED = ['.git','.hg','.next','.pnpm-store','.svn','.turbo','.yarn','build','coverage','dist','node_modules'];
// Frozen BEFORE measurements. Local 6000-file feasibility, not a universal service SLA.
const budget = { rootListMs: 1000, nameEnumerationMs: 5000, fullSearchMs: 10000, firstResultMs: 5000, cancelExitMs: 1000, resultLines: 100, maxFileBytes: 20*1024*1024, protocolLineBytes: 2*1024*1024 };
const report = { startedAt: new Date().toISOString(), scope: 'isolated real temporary filesystem, ripgrep; no App/GUI/platform acceptance', budget, cases: [], environment: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version, rg: execFileSync('rg',['--version'],{encoding:'utf8'}).split('\n')[0], locale: Intl.DateTimeFormat().resolvedOptions().locale } };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const work = await fs.mkdtemp(path.join(os.tmpdir(),'m9-predev-fs-'));
const root = path.join(work,'root'); await fs.mkdir(root);
const put = async (name, bytes) => { const f=path.join(root,name); await fs.mkdir(path.dirname(f),{recursive:true}); await fs.writeFile(f,bytes); };
const caseRun = async (id,title,fn) => {const start=performance.now();try{report.cases.push({id,title,status:'passed',ms:+(performance.now()-start).toFixed(2),evidence:await fn()});}catch(e){report.cases.push({id,title,status:'failed',error:String(e.stack)});} };
const argsBase = ['--hidden','--no-ignore','--no-config',...EXCLUDED.flatMap(x=>['-g',`!**/${x}/**`])];
function listNames() { return execFileSync('rg',['--files','--null',...argsBase,'.'],{cwd:root,maxBuffer:16*1024*1024}).toString().split('\0').filter(Boolean).map(x=>x.replace(/^\.\//,'')); }
async function listing(dir) { const list=await fs.readdir(dir,{withFileTypes:true}); return list.map((e,i)=>({name:e.name,kind:e.isDirectory()?'directory':e.isSymbolicLink()?'symlink':'file',index:i})).sort((a,b)=>(a.kind==='directory'?0:1)-(b.kind==='directory'?0:1)||a.name.localeCompare(b.name)||a.index-b.index); }
async function search(query,{mask,limit=budget.resultLines,abortOnFirst=false}={}) {
  if(!query||query.length>256) throw Error('invalid-query');
  const child=spawn('rg',['--json','--fixed-strings','--case-sensitive','--encoding','none','--max-filesize',String(budget.maxFileBytes),...argsBase,...(mask?['--glob',mask]:[]),'--',query,'.'],{cwd:root,stdio:['ignore','pipe','pipe']});
  const start=performance.now();let buf=Buffer.alloc(0),stderr='',first=null,stopAt=null,reason=null,invalid=0;const rows=[];
  const stop=why=>{if(!reason){reason=why;stopAt=performance.now();child.kill('SIGTERM');}};
  const timer=setTimeout(()=>stop('timeout'),budget.fullSearchMs);
  child.stderr.on('data',x=>{stderr=(stderr+x.toString()).slice(0,8192);});
  child.stdout.on('data',chunk=>{buf=Buffer.concat([buf,chunk]);while(buf.includes(10)){const at=buf.indexOf(10);const line=buf.subarray(0,at);buf=buf.subarray(at+1);if(reason)continue;if(line.length>budget.protocolLineBytes){stop('response-too-large');break;}let m;try{m=JSON.parse(line);}catch{stop('invalid-response');break;}if(m.type!=='match')continue;if(typeof m.data.lines.text!=='string'||typeof m.data.path.text!=='string'){invalid++;continue;}if(first===null)first=performance.now()-start;const text=m.data.lines.text;const offsets=m.data.submatches.map(s=>({from:Buffer.from(text).subarray(0,s.start).toString('utf8').length,to:Buffer.from(text).subarray(0,s.end).toString('utf8').length}));rows.push({path:m.data.path.text.replace(/^\.\//,''),line:m.data.line_number,text,offsets});if(abortOnFirst)stop('cancelled');else if(rows.length>=limit)stop('limit');}if(buf.length>budget.protocolLineBytes)stop('response-too-large');});
  const exit=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
  return {rows,reason,exit,invalid,stderr,firstMs:first,totalMs:performance.now()-start,stopToExitMs:stopAt===null?null:performance.now()-stopAt};
}
try {
  for(let d=0;d<20;d++){await fs.mkdir(path.join(root,`folder-${d}`));await Promise.all(Array.from({length:300},(_,i)=>put(`folder-${d}/item-${i}.ts`,`// 中文 😀 ${d}:${i}\nexport const n${i} = ${i}; // COMMON_NEEDLE\n`)));}
  await put('.hidden.txt','HIDDEN_NEEDLE\n');await put('.gitignore','ignored-by-git.txt\n');await put('ignored-by-git.txt','IGNORED_FILE_NEEDLE\n');
  for(const name of EXCLUDED)await put(`${name}/excluded.txt`,'EXCLUDED_NEEDLE\n');
  await put('中文 空格/quote\'"name.ts','中文😀 before TARGET after\r\nnext TARGET\n');await put('中文 空格/other.md','TARGET\n');
  await put('literal\nnewline.txt','NEWLINE_NAME\n');await put('binary.bin',Buffer.from([0,1,2,84,65,82,71,69,84,0]));await put('invalid.txt',Buffer.from([0xff,0xfe,84,65,82,71,69,84,10]));
  await fs.writeFile(path.join(work,'outside.txt'),'OUTSIDE_CANARY\n');await fs.symlink(path.join(work,'outside.txt'),path.join(root,'outside-link'));await fs.symlink(root,path.join(root,'loop-link'));await fs.symlink(path.join(root,'missing'),path.join(root,'broken-link'));
  const rootStat=await fs.stat(root);report.fixture={files:6000,folders:20,canarySha256:sha(await fs.readFile(path.join(work,'outside.txt'))),fingerprint:sha('20x300:'+EXCLUDED.join(',')+':unicode-crlf-hidden-ignore-symlink-binary-v1')};
  await caseRun('FS01','普通树包含隐藏和排除目录；按层读取、目录优先且同类稳定排序',async()=>{const t=performance.now(),a=await listing(root),ms=performance.now()-t;assert(ms<budget.rootListMs);assert(a.some(x=>x.name==='.hidden.txt')&&a.some(x=>x.name==='node_modules'));assert(a.findIndex(x=>x.kind!=='directory')>=20);assert.equal((await listing(path.join(root,'folder-0'))).length,300);return {rootEntries:a.length,elapsedMs:ms,subdirectoryEntries:300};});
  await caseRun('FS02','名称枚举含未展开目录和点文件；固定路径段排除不等于gitignore',async()=>{const t=performance.now(),a=listNames(),ms=performance.now()-t;assert(ms<budget.nameEnumerationMs);assert(a.includes('folder-19/item-299.ts')&&a.includes('.hidden.txt')&&a.includes('ignored-by-git.txt'));assert(!a.some(x=>x.split('/').some(s=>EXCLUDED.includes(s))));assert(a.includes('literal\nnewline.txt'));return {count:a.length,elapsedMs:ms,nullDelimitedNames:true,ignorePolicy:'fixed-segment-exclusions; include dotfiles; do not inherit project/global gitignore'};});
  await caseRun('FS03','默认不跟随根外、循环和失效symlink',async()=>{const a=listNames(),s=await search('OUTSIDE_CANARY');assert(!a.some(x=>/link/.test(x)));assert.equal(s.rows.length,0);assert.equal(s.exit.code,1);assert.equal(sha(await fs.readFile(path.join(work,'outside.txt'))),report.fixture.canarySha256);return {symlinksShownInTree:true,followedBySearch:false,noResultExitCode:1};});
  await caseRun('FS04','真实搜索UTF-8字节范围转UTF-16位置，CRLF/中文/emoji/带引号路径可定位',async()=>{const s=await search('TARGET',{mask:'*.ts'});assert.equal(s.rows.length,2);const a=s.rows.find(x=>x.line===1);assert.equal(a.offsets[0].from,'中文😀 before '.length);assert.equal(a.text.slice(a.offsets[0].from,a.offsets[0].to),'TARGET');assert(a.path.includes('quote\'"'));assert(a.text.endsWith('\r\n'));return s;});
  await caseRun('FS05','mask按参数传递，不做shell拼接；不存在匹配不是查询失败',async()=>{const a=await search('TARGET',{mask:'*.md'}),b=await search('UNMATCHED');assert.equal(a.rows.length,1);assert.equal(b.exit.code,1);assert.equal(b.rows.length,0);return {maskRows:a.rows.length,emptyExit:b.exit.code};});
  await caseRun('FS06','二进制与非法UTF-8不生成误导性文本定位',async()=>{const a=await search('TARGET');assert(!a.rows.some(x=>x.path==='binary.bin'||x.path==='invalid.txt'));assert(a.invalid>=1);return {textMatches:a.rows.length,invalidTextSkipped:a.invalid,binarySkipped:true};});
  await caseRun('FS07','100匹配行上限终止真实进程并明确部分结果',async()=>{const a=await search('COMMON_NEEDLE');assert.equal(a.rows.length,100);assert.equal(a.reason,'limit');assert(a.stopToExitMs<budget.cancelExitMs);assert(a.firstMs<budget.firstResultMs);return {...a,rows:a.rows.slice(0,2),returnedLines:100,mayHaveMore:true};});
  await caseRun('FS08','取消流式查询后真实进程退出，已排队结果不再追加',async()=>{const a=await search('COMMON_NEEDLE',{abortOnFirst:true});assert.equal(a.reason,'cancelled');assert.equal(a.rows.length,1);assert(a.stopToExitMs<budget.cancelExitMs);return a;});
  await caseRun('FS09','根目录被替换时旧lease身份失效',async()=>{await fs.rename(root,root+'-old');await fs.mkdir(root);const now=await fs.stat(root);const stale=now.dev!==rootStat.dev||now.ino!==rootStat.ino;assert(stale);await fs.rmdir(root);await fs.rename(root+'-old',root);return {staleDetected:true,requiredHandling:'discard old generation; re-authorize root; no silent rebind'};});
  await caseRun('FS10','已删除目录返回明确错误，不冒充空目录',async()=>{let code;try{await listing(path.join(root,'missing-dir'));}catch(e){code=e.code;}assert.equal(code,'ENOENT');return {code};});
  await caseRun('FS11','6000真实文件无命中查询三轮成本',async()=>{const rounds=[];for(let i=0;i<3;i++){const s=await search('ABSENT_NEEDLE');assert.equal(s.exit.code,1);assert(s.totalMs<budget.fullSearchMs);rounds.push(+s.totalMs.toFixed(2));}return {roundsMs:rounds,coldCache:false,uiScrolling:'covered separately by existing prototype; no new GUI timing claim'};});
} finally {await fs.rm(work,{recursive:true,force:true});}
report.completedAt=new Date().toISOString();report.cleanup=!sync.existsSync(work);report.scriptSha256=sha(await fs.readFile(fileURLToPath(import.meta.url)));report.summary=Object.fromEntries(['passed','failed'].map(k=>[k,report.cases.filter(x=>x.status===k).length]));
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({summary:report.summary,failures:report.cases.filter(x=>x.status==='failed')}));process.exitCode=report.summary.failed?1:0;
