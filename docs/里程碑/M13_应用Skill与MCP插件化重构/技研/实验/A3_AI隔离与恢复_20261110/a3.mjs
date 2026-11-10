// A3：Claude 不回退订阅负例、并发隔离、恢复模型解析。全部诱饵值＋本机模拟；外部连接经记录代理全部拒绝。
import http from 'node:http';import net from 'node:net';import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,realpathSync,existsSync,chmodSync} from 'node:fs';import {join} from 'node:path';
const root=realpathSync(mkdtempSync('/tmp/m13-a3-run-'));const out={cases:{}};
const rnd=()=>Math.random().toString(36).slice(2,10);
const TOK={A:'tokA-'+rnd(),B:'tokB-'+rnd(),BAD:'bad-'+rnd(),APIKEY_BAD:'sk-ant-api-decoy-'+rnd(),OAT:'sk-ant-oat01-decoy-'+rnd(),HELPER:'helper-decoy-'+rnd()};
const label=v=>Object.entries(TOK).find(([k,x])=>v&&v.includes(x))?.[0]??(v?'OTHER':null);
// recording CONNECT proxy: logs target host and refuses
const proxyLog=[];const proxy=http.createServer((q,r)=>{proxyLog.push({kind:'http',url:q.url.slice(0,120)});r.writeHead(403);r.end();});
proxy.on('connect',(q,s)=>{proxyLog.push({kind:'connect',host:q.url});s.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
await new Promise(x=>proxy.listen(0,'127.0.0.1',x));const PROXY=`http://127.0.0.1:${proxy.address().port}`;
// mocks: behaviour by token; response model = requested + suffix (server-reported differs)
function mkMock(name){const log=[];let mode={};const s=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{if(!q.url.startsWith('/v1/messages')||q.url.includes('count')){r.writeHead(404);r.end('{}');return;}
 let b={};try{b=JSON.parse(Buffer.concat(c))}catch{};const auth=q.headers.authorization||'',xkey=q.headers['x-api-key']||'';
 log.push({mock:name,model:b.model,auth:label(auth),xapikey:label(xkey)});
 if(auth.includes(TOK.BAD)||(!auth&&!xkey)||mode.fail){r.writeHead(mode.fail||401,{'content-type':'application/json'});r.end(JSON.stringify({type:'error',error:{type:mode.fail?'api_error':'authentication_error',message:'mock reject'}}));return;}
 const srvModel=(b.model||'')+'-srv';r.writeHead(200,{'content-type':'text/event-stream'});const e=(t,d)=>r.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);
 e('message_start',{message:{id:'m',type:'message',role:'assistant',model:srvModel,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});e('content_block_start',{index:0,content_block:{type:'text',text:''}});e('content_block_delta',{index:0,delta:{type:'text_delta',text:'OK-'+name}});e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:1}});e('message_stop',{});r.end();});});
 return {s,log,set:m=>mode=m};}
const mA=mkMock('A'),mB=mkMock('B');await new Promise(x=>mA.s.listen(0,'127.0.0.1',x));await new Promise(x=>mB.s.listen(0,'127.0.0.1',x));
const URL_A=`http://127.0.0.1:${mA.s.address().port}`,URL_B=`http://127.0.0.1:${mB.s.address().port}`;
const base=cfg=>({PATH:process.env.PATH,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:cfg,HTTPS_PROXY:PROXY,HTTP_PROXY:PROXY,ALL_PROXY:PROXY,NO_PROXY:'127.0.0.1,localhost',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
let n=0;function claude(lbl,env,args,{cfg,prep}={}){return new Promise(res=>{cfg=cfg||join(root,'cc'+(++n));mkdirSync(cfg,{recursive:true});if(prep)prep(cfg);const pd=join(root,'p'+n);mkdirSync(pd,{recursive:true});
 const pb=proxyLog.length,ab=mA.log.length,bb=mB.log.length;const c=spawn('claude',['-p','--output-format','json',...args],{cwd:pd,env:{...base(cfg),...env},stdio:['ignore','pipe','pipe']});let so='',se='';c.stdout.on('data',b=>so+=b);c.stderr.on('data',b=>se+=b);const k=setTimeout(()=>c.kill('SIGTERM'),60000);
 c.on('close',(code,sig)=>{clearTimeout(k);let j={};try{j=JSON.parse(so)}catch{};const r={code,sig,result:String(j.result??so).slice(0,160),isError:j.is_error??null,session:j.session_id??null,mockA:mA.log.slice(ab),mockB:mB.log.slice(bb),proxy:proxyLog.slice(pb),stderr:se.split('\n').filter(l=>l&&!/unrecognized_model/.test(l)).slice(-2).map(l=>l.slice(0,180)),cfg};if(lbl)out.cases[lbl]=r;res(r);});});}
// ===== N: no fallback negatives (no real credential involved; HOME real so keychain lookup path is the real one)
await claude('N1_missing_token',{ANTHROPIC_BASE_URL:URL_A},['--model','m','hi']);
await claude('N2_invalid_token_401',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.BAD},['--model','m','hi']);
await claude('N3_apikey_bad_and_authtoken_good',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.A,ANTHROPIC_API_KEY:TOK.APIKEY_BAD},['--model','m','hi']);
await claude('N4_oauth_env_only',{ANTHROPIC_BASE_URL:URL_A,CLAUDE_CODE_OAUTH_TOKEN:TOK.OAT},['--model','m','hi']);
await claude('N5_oauth_env_plus_authtoken',{ANTHROPIC_BASE_URL:URL_A,CLAUDE_CODE_OAUTH_TOKEN:TOK.OAT,ANTHROPIC_AUTH_TOKEN:TOK.A},['--model','m','hi']);
await claude('N6_residual_settings_env',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.A},['--model','m','hi'],{prep:cfg=>writeFileSync(join(cfg,'settings.json'),JSON.stringify({env:{ANTHROPIC_BASE_URL:URL_B,ANTHROPIC_AUTH_TOKEN:TOK.B}}))});
const helper=join(root,'helper.sh');writeFileSync(helper,`#!/bin/sh\necho ${TOK.HELPER}\n`);chmodSync(helper,0o755);
await claude('N7_residual_apiKeyHelper',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.A},['--model','m','hi'],{prep:cfg=>writeFileSync(join(cfg,'settings.json'),JSON.stringify({apiKeyHelper:helper}))});
await claude('N8_settings_flag_overrides',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.A},['--settings',JSON.stringify({env:{ANTHROPIC_BASE_URL:URL_B,ANTHROPIC_AUTH_TOKEN:TOK.B}}),'--model','m','hi']);
// ===== C: concurrency (two configs at once, different endpoint/token/model)
const [ca,cb]=await Promise.all([claude('C1_concurrent_A',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.A},['--model','model-A','hi A']),claude('C1_concurrent_B',{ANTHROPIC_BASE_URL:URL_B,ANTHROPIC_AUTH_TOKEN:TOK.B},['--model','model-B','hi B'])]);
// ===== R: model resolution for resume
const r1=await claude('R1_request_vs_reported',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.A},['--model','req-model','hi']);
const r2=await claude('R2_resume_switch',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.A},['--resume',r1.session,'--model','req-two','again'],{cfg:r1.cfg});
mA.set({fail:500});const r3=await claude('R3_resume_failed_turn',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.A},['--resume',r1.session,'--model','req-three','fail'],{cfg:r1.cfg});mA.set({});
const r4=await claude('R4_alias_sonnet',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.A,ANTHROPIC_DEFAULT_SONNET_MODEL:'mapped-sonnet'},['--model','sonnet','hi']);
const jl=(cfg,sid)=>{const f=[];const w=d=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);e.isDirectory()?w(p):p.endsWith(sid+'.jsonl')&&f.push(p)}};w(join(cfg,'projects'));return f[0]?readFileSync(f[0],'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)):[];};
const summ=L=>L.filter(x=>x.type==='assistant').map(x=>({model:x.message?.model,isApiErrorMessage:x.isApiErrorMessage??null,isSidechain:x.isSidechain??null,text:JSON.stringify(x.message?.content).slice(0,60)}));
out.R_jsonl_session1=summ(jl(r1.cfg,r1.session));
out.R_jsonl_alias=summ(jl(r4.cfg,r4.session));
out.R_jsonl_anyRequestedModelString={reqModel:JSON.stringify(jl(r1.cfg,r1.session)).includes('"req-model"'),reqTwo:JSON.stringify(jl(r1.cfg,r1.session)).includes('"req-two"'),aliasWord:JSON.stringify(jl(r4.cfg,r4.session)).includes('sonnet')};
proxy.close();mA.s.close();mB.s.close();
let txt=JSON.stringify(out,null,1).replaceAll(root,'<root>');for(const[k,v]of Object.entries(TOK))txt=txt.replaceAll(v,`<${k}>`);writeFileSync(join(root,'result.json'),txt);console.log(txt);
