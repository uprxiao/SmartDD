import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,symlinkSync,statSync,readdirSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
const CLI='/Users/liubu/.local/bin/codex';
const root=mkdtempSync(join(tmpdir(),'m13-tcfg-'));
const out={root,cli:spawnSync(CLI,['--version'],{encoding:'utf8'}).stdout.trim(),requests:[],cases:{}};
const sha=p=>existsSync(p)?createHash('sha256').update(readFileSync(p)).digest('hex'):null;
const KEY='wy-test-key-'+Math.random().toString(36).slice(2);
const server=createServer((req,res)=>{const c=[];req.on('data',b=>c.push(b));req.on('end',()=>{
  if(!req.url.endsWith('/responses')){res.writeHead(404);res.end();return;}
  const body=JSON.parse(Buffer.concat(c).toString());const n=out.requests.length+1;
  out.requests.push({n,url:req.url,model:body.model,authMatches:req.headers.authorization==='Bearer '+KEY,authPresent:!!req.headers.authorization});
  const text='MOCK_'+n,id='msg_'+n,item={id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
  res.writeHead(200,{'content-type':'text/event-stream',connection:'close'});
  const s=(t,d)=>res.write('event: '+t+'\ndata: '+JSON.stringify({type:t,...d})+'\n\n');
  s('response.created',{response:{id:'r'+n,status:'in_progress',output:[]}});
  s('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});
  s('response.output_text.delta',{item_id:id,output_index:0,content_index:0,delta:text});
  s('response.output_item.done',{output_index:0,item});
  s('response.completed',{response:{id:'r'+n,status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port;
const home=join(root,'home'),ch=join(root,'codex-home'),cwd=join(root,'proj');
for(const d of [home,ch,cwd])mkdirSync(d,{recursive:true});
writeFileSync(join(ch,'config.toml'),'model = "cfg-default"\n');
const cfgSha0=sha(join(ch,'config.toml'));
const env={PATH:process.env.PATH,HOME:home,CODEX_HOME:ch,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',WY_T_KEY:KEY};
const prov=['-c','model_provider="wy"','-c',`model_providers.wy={name="WillYou test",base_url="http://127.0.0.1:${port}/v1",wire_api="responses",env_key="WY_T_KEY"}`];
const common=['--skip-git-repo-check','--json','-c','analytics.enabled=false','-c','feedback.enabled=false'];
async function run(label,args,e=env){const before=out.requests.length;
  const p=await new Promise(r=>{const {spawn}=globalThis.__cp;const c=spawn(CLI,args,{cwd,env:e,stdio:["ignore","pipe","pipe"]});let so='',se='';c.stdout.on('data',b=>so+=b);c.stderr.on('data',b=>se+=b);const t=setTimeout(()=>c.kill('SIGTERM'),60000);c.on('close',(code,sig)=>{clearTimeout(t);r({code,sig,so,se});});});
  const thread=(p.so.match(/"thread_id":"([^"]+)"/)||[])[1]||null;
  out.cases[label]={args:args.map(a=>String(a).replace(KEY,'<KEY>')),code:p.code,signal:p.sig,thread,newRequests:out.requests.slice(before),stdoutHead:p.so.split("\n").filter(Boolean).slice(0,4).map(l=>l.slice(0,300)),stderrTail:p.se.split('\n').filter(Boolean).slice(-3).map(l=>l.slice(0,200))};
  return thread;}
globalThis.__cp=await import('node:child_process');
// E1: per-run -c provider + env key, explicit model
const tid=await run('E1_exec_modelA',['exec',...common,...prov,'-m','model-a','hello']);
if(!tid){console.log(JSON.stringify(out,null,1));process.exit(2);}
out.cases.E1_configTomlUnchanged=sha(join(ch,'config.toml'))===cfgSha0;
// E3: resume behaviour
await run('E3a_resume_noModel',['exec','resume',...common,...prov,tid,'again']);
await run('E3b_resume_modelB',['exec','resume',...common,...prov,'-m','model-b',tid,'switch']);
await run('E3c_resume_noModel_afterB',['exec','resume',...common,...prov,tid,'after']);
// E4: resume without provider override (external blocked by dead proxy)
await run('E4_resume_noProvider',['exec','resume',...common,tid,'noprov']);
out.cases.E3_configTomlUnchanged=sha(join(ch,'config.toml'))===cfgSha0;
// rollout turn_context models
const sess=[];const walk=d=>{for(const f of readdirSync(d,{withFileTypes:true})){const p=join(d,f.name);f.isDirectory()?walk(p):f.name.endsWith('.jsonl')&&sess.push(p);}};
if(existsSync(join(ch,'sessions')))walk(join(ch,'sessions'));
out.rollouts=sess.map(p=>{const L=readFileSync(p,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
  return {file:p.replace(root,'<root>'),meta:L.filter(x=>x.type==='session_meta').map(x=>({provider:x.payload.model_provider})),turnContexts:L.filter(x=>x.type==='turn_context').map(x=>({model:x.payload.model,effort:x.payload.effort??x.payload.reasoning_effort??null}))};});
// E2: login status in isolated homes
const real=join(homedir(),'.codex','auth.json');const realSha0=sha(real),realM0=statSync(real).mtimeMs;
const ls=(label,chome)=>{const r=spawnSync(CLI,['login','status'],{env:{...env,CODEX_HOME:chome,WY_T_KEY:''},encoding:'utf8',timeout:30000});
  const t=(r.stdout+r.stderr).split('\n').filter(Boolean).map(l=>l.replace(/[\w.+-]+@[\w.-]+/g,'<email>').replace(/sk-[\w-]+/g,'<key>').slice(0,120));out.cases[label]={code:r.status,lines:t.slice(0,3)};};
const empty=join(root,'empty-home');mkdirSync(empty);ls('E2a_login_empty',empty);
const linked=join(root,'linked-home');mkdirSync(linked);symlinkSync(real,join(linked,'auth.json'));ls('E2b_login_symlinkAuth',linked);
out.cases.E2_realAuthUnchanged={sha:sha(real)===realSha0,mtime:statSync(real).mtimeMs===realM0};
server.close();
writeFileSync(join(root,'result.json'),JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
