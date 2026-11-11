// 归档说明：SMG 内网地址不入库（用户 2026-11-11 决定），已替换为占位 <SMG 内网地址>；运行时使用实际地址。
// 补验 D · R4/R5：Claude Code 经 SMG 网关真实运行；原始接口测试与 CLI 实际运行对比（用户 2026-11-11 授权使用 SMG Key）。
// Key 只从环境变量 SMG_KEY 读取，不打印、不写入结果；记录代理只记录是否带认证头。
import http from 'node:http';import {spawn,execFileSync} from 'node:child_process';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import os from 'node:os';
const KEY=process.env.SMG_KEY;if(!KEY)throw new Error('缺 SMG_KEY');const UP={host:'<SMG 内网地址>',port:0};
const MODELS=(process.env.MODELS||'deepseek-v4-pro-0813,deepseek-v4-flash-0731,glm-5,kimi-k2.5,qwen3.6-plus,MiniMax-M2.7,GLM-4.7-FP8,claude-haiku-5-5').split(',');
const log=[];let tag='';
const proxy=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{const body=Buffer.concat(chunks);let j={};try{j=JSON.parse(body.toString()||'{}')}catch{}
 const rec={tag,method:req.method,path:req.url.split('?')[0],model:j.model,stream:j.stream,tools:(j.tools||[]).length,beta:req.headers['anthropic-beta']||null,bearer:/^Bearer /.test(req.headers.authorization||''),xApiKey:!!req.headers['x-api-key'],thinking:!!j.thinking};
 const up=http.request({...UP,method:req.method,path:req.url,headers:{...req.headers,host:`${UP.host}:${UP.port}`}},r=>{rec.status=r.statusCode;const out=[];r.on('data',c=>{out.push(c);res.write(c)});r.on('end',()=>{const s=Buffer.concat(out).toString();if(r.statusCode>=400)rec.error=s.slice(0,240);else if(rec.stream)rec.toolUse=/"type"\s*:\s*"tool_use"/.test(s);log.push(rec);res.end();});res.writeHead(r.statusCode,r.headers);});
 up.on('error',e=>{rec.status='ERR';rec.error=e.message;log.push(rec);res.writeHead(502);res.end();});up.end(body);});});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));const port=proxy.address().port;const BASE=`http://127.0.0.1:${port}`;
async function raw(model){tag='raw:'+model;const t=Date.now();const r=await fetch(BASE+'/v1/messages',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+KEY,'x-api-key':KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model,max_tokens:64,stream:true,messages:[{role:'user',content:'Call the wy_ping tool.'}],tools:[{name:'wy_ping',description:'Connectivity check.',input_schema:{type:'object',properties:{}}}],tool_choice:{type:'tool',name:'wy_ping'}})});const s=await r.text();
 return{status:r.status,ok:r.ok&&/"type"\s*:\s*"tool_use"/.test(s),ms:Date.now()-t,error:r.ok?null:s.slice(0,200)};}
const root=mkdtempSync(join(os.tmpdir(),'m13-r45-'));
function cli(model,{auth='bearer',nobeta=false}={}){return new Promise(resolve=>{tag=`cli:${model}:${auth}${nobeta?':nobeta':''}`;const cfg=join(root,'cfg-'+Math.random().toString(36).slice(2,7)),proj=join(root,'proj');mkdirSync(cfg,{recursive:true});mkdirSync(proj,{recursive:true});
 for(const f of ['a.txt','b.txt','c.txt'])writeFileSync(join(proj,f),'x');
 writeFileSync(join(cfg,'settings.json'),JSON.stringify({modelPicker:{options:[{model}],replaceBuiltInOptions:true}}));
 writeFileSync(join(cfg,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,lastOnboardingVersion:'2.1.322',projects:{[proj]:{hasTrustDialogAccepted:true}}}));
 const tiers=Object.fromEntries(['ANTHROPIC_MODEL','ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','ANTHROPIC_DEFAULT_FABLE_MODEL','ANTHROPIC_SMALL_FAST_MODEL','CLAUDE_CODE_SUBAGENT_MODEL'].map(k=>[k,model]));
 const env={PATH:process.env.PATH,HOME:os.homedir(),TMPDIR:process.env.TMPDIR||'/tmp',CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:BASE,...(auth==='bearer'?{ANTHROPIC_AUTH_TOKEN:KEY}:{ANTHROPIC_API_KEY:KEY}),...tiers,
  HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_1M_CONTEXT:'1',...(nobeta?{CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS:'1'}:{})};
 const t=Date.now();const p=spawn('claude',['-p','--setting-sources','user','--strict-mcp-config','--permission-mode','default','--allowedTools','Bash(ls:*)','--output-format','json','Run ls in the current directory, then reply exactly FILES=<number of entries>.'],{cwd:proj,env});
 let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);const timer=setTimeout(()=>p.kill('SIGKILL'),180000);
 p.on('close',code=>{clearTimeout(timer);let j=null;try{j=JSON.parse(out)}catch{}resolve({exit:code,ms:Date.now()-t,result:j?.result?.slice?.(0,160)??null,isError:j?.is_error??null,numTurns:j?.num_turns??null,stderr:err.replaceAll(KEY,'<KEY>').slice(-300)});});});}
const rows=[];
for(const m of MODELS){const r=await raw(m);const c=await cli(m);rows.push({model:m,raw:r,cli:c,cliRequests:log.filter(x=>x.tag===`cli:${m}:bearer`).map(({tag,...x})=>x)});}
// 认证头与 beta 头的补充对照（只用第一个模型）
const m0=MODELS[0];const apiKeyRun=await cli(m0,{auth:'apikey'});const nobetaRun=await cli(m0,{nobeta:true});
const out={claudeVersion:execFileSync('claude',['--version'],{encoding:'utf8'}).trim(),rows,authVariant:{model:m0,apikey:apiKeyRun,requests:log.filter(x=>x.tag===`cli:${m0}:apikey`).map(({tag,...x})=>x)},nobetaVariant:{model:m0,run:nobetaRun,requests:log.filter(x=>x.tag===`cli:${m0}:bearer:nobeta`).map(({tag,...x})=>x)}};
proxy.close();rmSync(root,{recursive:true,force:true});
const s=JSON.stringify(out,null,1);if(s.includes(KEY))throw new Error('结果中出现 Key，已中止');console.log(s);
