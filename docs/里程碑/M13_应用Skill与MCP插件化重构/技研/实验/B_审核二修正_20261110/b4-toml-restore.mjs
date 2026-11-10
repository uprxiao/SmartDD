// 补验 B4（审核二 F05）：Codex 全局 model／model_reasoning_effort 定点还原 v2。
// 用 TOML 解析器（项目已有依赖 smol-toml 1.9.1）判断键的存在与值；只做单行定点编辑并保留行尾注释；
// 编辑后重新解析，除目标键外整份配置必须与编辑前深度相等，否则拒绝还原（宁可不改）。
// 落盘：读取时记录 SHA256 → 写前重读比较（文件级比较并交换）→ 同目录临时文件＋rename 原子替换，保留权限位。
import {parse} from '/Users/liubu/hx/4.uprxiao/SmartDD/node_modules/smol-toml/dist/index.js';
import {readFileSync,writeFileSync,renameSync,rmSync,statSync,chmodSync,mkdtempSync,realpathSync} from 'node:fs';import {createHash} from 'node:crypto';import {join,dirname} from 'node:path';import {isDeepStrictEqual} from 'node:util';
export const KEYS=['model','model_reasoning_effort'];
const sha=t=>createHash('sha256').update(t).digest('hex');
export function readTop(text){let o;try{o=parse(text)}catch(e){return {ok:false,reason:'TOML 解析失败：'+e.message.split('\n')[0]}}
 const r={};for(const k of KEYS){if(!(k in o))continue;if(typeof o[k]!=='string')return {ok:false,reason:`${k} 不是字符串，不支持还原`};r[k]=o[k];}
 const lines=text.split('\n'),end=topRegionEnd(lines),raw={};for(const k of KEYS){const h=lines.slice(0,end).filter(l=>keyLineRe(k).test(l));if(h.length===1)raw[k]=h[0];}
 return {ok:true,values:r,raw,doc:o};}
const keyLineRe=k=>new RegExp(`^\\s*(?:${k}|"${k}"|'${k}')\\s*=`);
function topRegionEnd(lines){// 第一张表头之前为顶层；表头判定须经解析确认，避免多行字符串里的 [ 被误判
 for(let i=0;i<lines.length;i++){if(!/^\s*\[/.test(lines[i]))continue;try{parse(lines.slice(0,i).join('\n'));return i;}catch{}}return lines.length;}
function trailingComment(line,k){for(let i=line.indexOf('#');i>=0;i=line.indexOf('#',i+1)){try{const o=parse(line.slice(0,i));if(k in o)return line.slice(i);}catch{}}return '';}
export function setTop(text,k,v,rawLine){const lines=text.split('\n');const end=topRegionEnd(lines);const hits=[];for(let i=0;i<end;i++)if(keyLineRe(k).test(lines[i]))hits.push(i);
 if(hits.length>1)return {ok:false,reason:`${k} 出现多次`};const i=hits[0];
 if(v===undefined){if(i!==undefined)lines.splice(i,1);}

 else if(rawLine!==undefined&&i!==undefined)lines[i]=rawLine;
 else if(rawLine!==undefined)lines.splice(0,0,rawLine);
 else if(i!==undefined){const ind=/^\s*/.exec(lines[i])[0];const c=trailingComment(lines[i],k);lines[i]=`${ind}${k} = ${JSON.stringify(v)}${c?' '+c.trimStart():''}`;}
 else lines.splice(0,0,`${k} = ${JSON.stringify(v)}`);
 const t=lines.join('\n');
 // 校验：目标键为期望值，其余内容深度不变
 let before,after;try{before=parse(text);after=parse(t)}catch(e){return {ok:false,reason:'编辑后无法解析，拒绝'}}
 const strip=o=>{const c={...o};delete c[k];return c;};
 if(!isDeepStrictEqual(strip(before),strip(after)))return {ok:false,reason:'编辑会影响其他配置，拒绝'};
 if(v===undefined?(k in after):after[k]!==v)return {ok:false,reason:'不支持的写法（如多行字符串），拒绝'};
 return {ok:true,text:t};}
export function decide(before,afterText,sessionModels){const a=readTop(afterText);if(!a.ok)return {action:'no-offer',reason:a.reason};const after=a.values;
 const changed=KEYS.filter(k=>after[k]!==before[k]);if(!changed.length)return {action:'none'};
 if(!sessionModels.includes(after.model)&&after.model!==before.model)return {action:'no-offer',reason:'当前全局模型不是本会话用过的模型'};return {action:'offer',changed,expect:after};}
export function restoreText(currentText,before,expect,raw={}){const c=readTop(currentText);if(!c.ok)return {ok:false,reason:c.reason};
 for(const k of KEYS)if(c.values[k]!==expect[k])return {ok:false,reason:`${k} 已再次变化，放弃还原`};
 let t=currentText;for(const k of KEYS){if(c.values[k]===before[k])continue;const r=setTop(t,k,before[k],before[k]===undefined?undefined:raw[k]);if(!r.ok)return r;t=r.text;}return {ok:true,text:t};}
// 文件级：snapshotHash 为“决定还原时”读到的内容哈希
export function restoreFile(path,before,expect,{beforeWrite,raw}={}){const text=readFileSync(path,'utf8');const h0=sha(text);const r=restoreText(text,before,expect,raw);if(!r.ok)return r;
 const tmp=join(dirname(path),`.config.toml.willyou-${process.pid}-${Date.now()}`);writeFileSync(tmp,r.text,{mode:statSync(path).mode&0o777});
 if(beforeWrite)beforeWrite();
 if(sha(readFileSync(path,'utf8'))!==h0){rmSync(tmp,{force:true});return {ok:false,reason:'文件在还原期间被修改，放弃'};}
 renameSync(tmp,path);return {ok:true};}
// ---- 用例
if(import.meta.url===(await import('node:url')).pathToFileURL(process.argv[1]).href){
 const cases={};const sim=(orig,sessionModel,sessionEffort)=>{const b=readTop(orig);let a=orig;let r=setTop(a,'model',sessionModel);a=r.text;if(sessionEffort){r=setTop(a,'model_reasoning_effort',sessionEffort);a=r.text;}const d=decide(b.values,a,[sessionModel]);const x=d.expect?restoreText(a,b.values,d.expect,b.raw):d;return {before:b.values,decide:d.action,restoredOk:x.ok,equalsOriginal:x.text===orig,text:x.text};};
 cases.T1_review_counterexample_single_quote_comment=sim("model = 'user-default' # valid TOML\nmodel_reasoning_effort = \"high\"\n",'session-model');
 cases.T2_double_quote_plain=sim('model = "user-default"\nmodel_reasoning_effort = "high"\n\n[mcp_servers.keepme]\ncommand = "true"\n','s1','low');
 cases.T3_escape_and_comment_with_hash=sim('model = "a\\"b#c" # note # more\n','s2');
 cases.T4_quoted_key_and_indent=sim('  "model" = \'x\'\nother = 1\n[t]\nmodel = "table-scoped"\n','s3');
 cases.T5_absent_before=sim('x = 1\n[t]\ny = 2\n','s4');
 cases.T6_literal_with_bracket_line_multiline_other='other = """\n[not a table]\n"""\nmodel = "m0"\n';cases.T6_literal_with_bracket_line_multiline_other=sim(cases.T6_literal_with_bracket_line_multiline_other,'s5');
 // 不支持写法：多行字符串模型 → 拒绝而非误删
 {const orig='model = """\nuser-default"""\n';const b=readTop(orig);const r=setTop(orig,'model','s6');cases.T7_multiline_value_refused={before:b.values,setOk:r.ok,reason:r.reason};}
 // 非字符串 → 拒绝
 cases.T8_non_string=readTop('model = 5\n');
 // 并发：决定后用户又改了模型 → 放弃
 {const orig='model = "u"\n';const b=readTop(orig).values;const a=setTop(orig,'model','s').text;const d=decide(b,a,['s']);const user=setTop(a,'model','user-new').text;cases.T9_user_changed_after=restoreText(user,b,d.expect);}
 // 文件级比较并交换：写前被外部改动 → 放弃且原文件保持外部写入内容；正常路径保留权限位
 {const dir=realpathSync(mkdtempSync('/tmp/m13-b4-'));const p=join(dir,'config.toml');const orig="model = 'u' # c\n[mcp_servers.k]\ncommand = \"true\"\n";writeFileSync(p,orig,{mode:0o600});
  const bs=readTop(orig),b=bs.values;const a=setTop(orig,'model','s').text;writeFileSync(p,a);const d=decide(b,a,['s']);
  const ext="model = 's' # c\n[mcp_servers.k]\ncommand = \"true\"\n[mcp_servers.added]\ncommand = \"echo\"\n";
  const r1=restoreFile(p,b,d.expect,{raw:bs.raw,beforeWrite:()=>writeFileSync(p,ext)});const afterRace=readFileSync(p,'utf8');
  writeFileSync(p,a);const r2=restoreFile(p,b,d.expect,{raw:bs.raw});const fin=readFileSync(p,'utf8');
  cases.T10_file_cas={raceResult:r1,raceKeptExternal:afterRace===ext,normalResult:r2,normalEqualsOriginal:fin===orig,mode:(statSync(p).mode&0o777).toString(8)};}
 const pass={T1:cases.T1_review_counterexample_single_quote_comment.equalsOriginal,T2:cases.T2_double_quote_plain.equalsOriginal,T3:cases.T3_escape_and_comment_with_hash.equalsOriginal,T4:cases.T4_quoted_key_and_indent.equalsOriginal,T5:cases.T5_absent_before.equalsOriginal,T6:cases.T6_literal_with_bracket_line_multiline_other.equalsOriginal,T7:cases.T7_multiline_value_refused.setOk===false,T8:cases.T8_non_string.ok===false,T9:cases.T9_user_changed_after.ok===false,T10:cases.T10_file_cas.raceResult.ok===false&&cases.T10_file_cas.raceKeptExternal&&cases.T10_file_cas.normalResult.ok&&cases.T10_file_cas.normalEqualsOriginal&&cases.T10_file_cas.mode==='600'};
 console.log(JSON.stringify({smolToml:'1.9.1',cases,pass,allPass:Object.values(pass).every(Boolean)},null,1));}
