// 补验 C2（审核三 G02）：全局模型还原的落盘改为“原子挪走＋校验＋仅在目标不存在时创建”，任何并发写入都不会被静默覆盖。
// 文本层（解析、定点编辑、整份比对）沿用 B4 v2 的 restoreText，不改。
// 步骤：①读取并计算新内容，写同目录临时文件（保留权限位）→ ②rename(原文件→捕获文件)：原子取走“此刻的真实内容” →
// ③捕获内容的哈希须等于①读到的哈希，否则说明有人在①之后写过：用 link 放回（目标若已被重建则两份都保留并报告）、放弃 →
// ④link(临时文件→原路径)：仅在原路径不存在时成功；若这段时间有人新建了文件，EEXIST → 保留对方文件、放弃 → ⑤成功后删除临时与捕获文件。
// 代价：②到④之间原路径短暂不存在（微秒级），此时读取者会看到“无配置”；写入者的内容总会留在原路径或捕获文件中并被报告。
import {readdirSync,readFileSync,writeFileSync,renameSync,linkSync,unlinkSync,rmSync,statSync,existsSync,mkdtempSync,realpathSync} from 'node:fs';import {createHash} from 'node:crypto';import {join,dirname,basename} from 'node:path';import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const {readTop,setTop,decide,restoreText}=await import(join(here,'../B_审核二修正_20261110/b4-toml-restore.mjs'));
const sha=t=>createHash('sha256').update(t).digest('hex');
export function restoreFileSwap(path,before,expect,{raw,hooks={}}={}){
 const text=readFileSync(path,'utf8');const h0=sha(text);const r=restoreText(text,before,expect,raw);if(!r.ok)return r;
 const tag=`${process.pid}-${Date.now()}`;const dir=dirname(path),b=basename(path);
 const tmp=join(dir,`.${b}.willyou-new-${tag}`),cap=join(dir,`.${b}.willyou-captured-${tag}`);
 writeFileSync(tmp,r.text,{mode:statSync(path).mode&0o777});
 hooks.beforeCapture?.();
 try{renameSync(path,cap);}catch(e){rmSync(tmp,{force:true});return {ok:false,reason:'配置文件已被移走或删除，放弃',code:e.code};}
 hooks.afterCapture?.();
 if(sha(readFileSync(cap))!==h0){rmSync(tmp,{force:true});
  try{linkSync(cap,path);unlinkSync(cap);return {ok:false,reason:'还原前文件已被修改，已放回对方内容，放弃'};}
  catch(e){if(e.code==='EEXIST')return {ok:false,reason:'检测到多次并发修改，已保留两份',kept:[path,cap]};throw e;}}
 try{linkSync(tmp,path);}catch(e){rmSync(tmp,{force:true});
  if(e.code==='EEXIST'){unlinkSync(cap);return {ok:false,reason:'还原期间其他程序写入了配置，已保留对方内容，放弃'};}
  try{linkSync(cap,path);unlinkSync(cap);}catch{}throw e;}
 unlinkSync(tmp);unlinkSync(cap);return {ok:true};}
if(import.meta.url===(await import('node:url')).pathToFileURL(process.argv[1]).href){
 const orig="model = 'user-default' # c\n[mcp_servers.k]\ncommand = \"true\"\n";
 const setup=()=>{const d=realpathSync(mkdtempSync('/tmp/m13-c2-'));const p=join(d,'config.toml');writeFileSync(p,orig,{mode:0o600});
  const bs=readTop(orig);const after=setTop(orig,'model','session-model').text;writeFileSync(p,after);const dec=decide(bs.values,after,['session-model']);return {d,p,bs,after,dec};};
 const leftovers=d=>readdirSync(d).filter(n=>n.includes('willyou'));
 const ext=s=>s+"external_user_change = true\n";const cases={};
 {const t=setup();const r=restoreFileSwap(t.p,t.bs.values,t.dec.expect,{raw:t.bs.raw});cases.N1_normal={r,equalsOriginal:readFileSync(t.p,'utf8')===orig,mode:(statSync(t.p).mode&0o777).toString(8),leftovers:leftovers(t.d),pass:r.ok&&readFileSync(t.p,'utf8')===orig&&(statSync(t.p).mode&0o777)===0o600&&leftovers(t.d).length===0};}
 // 审核注入点：哈希校验之后、替换之前写入
 {const t=setup();const r=restoreFileSwap(t.p,t.bs.values,t.dec.expect,{raw:t.bs.raw,hooks:{beforeCapture:()=>writeFileSync(t.p,ext(t.after))}});const cur=readFileSync(t.p,'utf8');
  cases.W1_write_before_capture={r,keptExternal:cur===ext(t.after),leftovers:leftovers(t.d),pass:!r.ok&&cur===ext(t.after)&&leftovers(t.d).length===0};}
 // 捕获后、放入前：外部程序以原子 rename 方式新建配置
 {const t=setup();const r=restoreFileSwap(t.p,t.bs.values,t.dec.expect,{raw:t.bs.raw,hooks:{afterCapture:()=>{const x=t.p+'.ext';writeFileSync(x,ext(t.after));renameSync(x,t.p);}}});const cur=readFileSync(t.p,'utf8');
  cases.W2_create_after_capture_rename={r,keptExternal:cur===ext(t.after),leftovers:leftovers(t.d),pass:!r.ok&&cur===ext(t.after)&&leftovers(t.d).length===0};}
 // 捕获后、放入前：外部程序直接写文件（非原子）
 {const t=setup();const r=restoreFileSwap(t.p,t.bs.values,t.dec.expect,{raw:t.bs.raw,hooks:{afterCapture:()=>writeFileSync(t.p,ext(t.after))}});const cur=readFileSync(t.p,'utf8');
  cases.W3_write_after_capture={r,keptExternal:cur===ext(t.after),leftovers:leftovers(t.d),pass:!r.ok&&cur===ext(t.after)&&leftovers(t.d).length===0};}
 // 两次并发：校验前已被改，且捕获后又被新建 → 两份都保留并报告
 {const t=setup();const r=restoreFileSwap(t.p,t.bs.values,t.dec.expect,{raw:t.bs.raw,hooks:{beforeCapture:()=>writeFileSync(t.p,ext(t.after)),afterCapture:()=>writeFileSync(t.p,ext(ext(t.after)))}});
  const keptBoth=r.kept&&readFileSync(r.kept[0],'utf8')===ext(ext(t.after))&&readFileSync(r.kept[1],'utf8')===ext(t.after);cases.W4_double_concurrent={r:{...r,kept:r.kept?.map(x=>basename(x).replace(/-\d+-\d+$/,'-<tag>'))},keptBoth,pass:!r.ok&&!!keptBoth};}
 // 文件已被删除
 {const t=setup();const r=restoreFileSwap(t.p,t.bs.values,t.dec.expect,{raw:t.bs.raw,hooks:{beforeCapture:()=>unlinkSync(t.p)}});cases.W5_deleted_meanwhile={r,stillAbsent:!existsSync(t.p),leftovers:leftovers(t.d),pass:!r.ok&&!existsSync(t.p)&&leftovers(t.d).length===0};}
 const pass=Object.fromEntries(Object.entries(cases).map(([k,v])=>[k,v.pass]));
 console.log(JSON.stringify({cases,pass,allPass:Object.values(pass).every(Boolean)},null,1));}
