// A3b：Codex 并发（共用 CODEX_HOME）＋全局 model 定点还原（比较并交换，只改两个键）
import http from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,realpathSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
const root=realpathSync(mkdtempSync('/tmp/m13-a3b-'));const out={};const CODEX='/Users/liubu/.local/bin/codex';
function mk(name){const log=[];const s=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{if(!q.url.endsWith('/responses')){r.writeHead(404);r.end();return;}const b=JSON.parse(Buffer.concat(c));log.push({mock:name,model:b.model,auth:q.headers.authorization});
 const item={id:'m',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK-'+name,annotations:[]}]};r.writeHead(200,{'content-type':'text/event-stream'});const e=(t,d)=>r.write('event: '+t+'\ndata: '+JSON.stringify({type:t,...d})+'\n\n');
 setTimeout(()=>{e('response.created',{response:{id:'r',status:'in_progress',output:[]}});e('response.output_item.done',{output_index:0,item});e('response.completed',{response:{id:'r',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});r.end();},800);});});return {s,log};}
const A=mk('A'),B=mk('B');await new Promise(x=>A.s.listen(0,'127.0.0.1',x));await new Promise(x=>B.s.listen(0,'127.0.0.1',x));
const ch=join(root,'shared-codex-home');mkdirSync(join(ch,'h'),{recursive:true});writeFileSync(join(ch,'config.toml'),'model = "user-default"\nmodel_reasoning_effort = "high"\n\n[mcp_servers.keepme]\ncommand = "true"\n');
const sha=()=>createHash('sha256').update(readFileSync(join(ch,'config.toml'))).digest('hex');const s0=sha();
const run=(p,url,key,model)=>new Promise(res=>{const c=spawn(CODEX,['exec','--skip-git-repo-check','--json','-c','analytics.enabled=false','-c',`model_provider="wy_${p}"`,'-c',`model_providers.wy_${p}={name="${p}",base_url="${url}/v1",wire_api="responses",env_key="WY_P_KEY"}`,'-m',model,'hi '+p],{cwd:root,env:{PATH:process.env.PATH,HOME:join(ch,'h'),CODEX_HOME:ch,WY_P_KEY:key,HTTPS_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'},stdio:['ignore','pipe','pipe']});let so='';c.stdout.on('data',b=>so+=b);c.on('close',code=>res({code,thread:(so.match(/"thread_id":"([^"]+)"/)||[])[1],text:(so.match(/"text":"(OK-[AB])"/)||[])[1]}));});
const [ra,rb]=await Promise.all([run('A',`http://127.0.0.1:${A.s.address().port}`,'key-A','model-A'),run('B',`http://127.0.0.1:${B.s.address().port}`,'key-B','model-B')]);
const sess=[];const w=d=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);e.isDirectory()?w(p):p.endsWith('.jsonl')&&sess.push(p)}};w(join(ch,'sessions'));
out.C2_codex_concurrent={A:{...ra,mock:A.log.map(x=>({model:x.model,keyOK:x.auth==='Bearer key-A'}))},B:{...rb,mock:B.log.map(x=>({model:x.model,keyOK:x.auth==='Bearer key-B'}))},
 rollouts:sess.map(f=>{const L=readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));return {provider:L.find(x=>x.type==='session_meta')?.payload.model_provider,models:L.filter(x=>x.type==='turn_context').map(x=>x.payload.model)};}),configUnchanged:sha()===s0};
A.s.close();B.s.close();
// ---- G1: targeted restore with compare-and-swap
const KEYS=['model','model_reasoning_effort'];
const readTop=t=>{const o={};for(const line of t.split('\n')){if(/^\s*\[/.test(line))break;const m=/^\s*(model|model_reasoning_effort)\s*=\s*"([^"]*)"\s*$/.exec(line);if(m)o[m[1]]=m[2];}return o;};
const setTop=(t,k,v)=>{const lines=t.split('\n');let end=lines.findIndex(l=>/^\s*\[/.test(l));if(end<0)end=lines.length;const i=lines.slice(0,end).findIndex(l=>new RegExp(`^\\s*${k}\\s*=`).test(l));
 if(v===undefined){if(i>=0)lines.splice(i,1);}else if(i>=0)lines[i]=`${k} = ${JSON.stringify(v)}`;else lines.splice(0,0,`${k} = ${JSON.stringify(v)}`);return lines.join('\n');};
// before: snapshot at launch; sessionModels: models WillYou observed in this session's turn_context
function decide(before,afterText,sessionModels){const after=readTop(afterText);const changed=KEYS.filter(k=>after[k]!==before[k]);if(!changed.length)return {action:'none'};
 if(!sessionModels.includes(after.model)&&after.model!==before.model)return {action:'no-offer',reason:'当前全局模型不是本会话用过的模型，可能是终端或其他程序修改'};return {action:'offer',changed,expect:after};}
function restore(currentText,before,expect){const cur=readTop(currentText);for(const k of KEYS)if(cur[k]!==expect[k])return {ok:false,reason:`${k} 已再次变化，放弃还原`};let t=currentText;for(const k of KEYS)t=setTop(t,k,before[k]);return {ok:true,text:t};}
const base='model = "user-default"\nmodel_reasoning_effort = "high"\n\n[mcp_servers.keepme]\ncommand = "true"\n';const before=readTop(base);
const cases={};
{const a=setTop(setTop(base,'model','deepseek-v4-pro'),'model_reasoning_effort','low');const d=decide(before,a,['deepseek-flash','deepseek-v4-pro']);const r=restore(a,before,d.expect);cases.G1_session_wrote={decide:d.action,restoredOk:r.ok,restoredEqualsBase:r.text===base};}
{const a=setTop(base,'model','deepseek-v4-pro');const d=decide(before,a,['deepseek-v4-pro']);const concurrent=a+'\n[mcp_servers.added_by_user]\ncommand = "echo"\n';const r=restore(concurrent,before,d.expect);cases.G2_user_added_other_key_meanwhile={decide:d.action,restoredOk:r.ok,keepsUserAddition:r.text.includes('added_by_user'),modelRestored:readTop(r.text).model==='user-default'};}
{const a=setTop(base,'model','deepseek-v4-pro');const d=decide(before,a,['deepseek-v4-pro']);const userChanged=setTop(a,'model','gpt-user-choice');const r=restore(userChanged,before,d.expect);cases.G3_user_changed_model_after={decide:d.action,restoredOk:r.ok,reason:r.reason,leftUserChoice:readTop(userChanged).model};}
{const a=setTop(base,'model','gpt-user-choice');cases.G4_changed_by_other_not_session=decide(before,a,['deepseek-v4-pro']);}
{cases.G5_unchanged=decide(before,base,['x']);}
{const nb=readTop('x = 1\n');const a=setTop('x = 1\n','model','deepseek-v4-pro');const d=decide(nb,a,['deepseek-v4-pro']);const r=restore(a,nb,d.expect);cases.G6_key_absent_before={decide:d.action,restoredOk:r.ok,removed:!/^model\s*=/m.test(r.text)};}
out.G_restore=cases;
writeFileSync(join(root,'result.json'),JSON.stringify(out,null,1));console.log(JSON.stringify(out,null,1).replaceAll(root,'<root>'));
