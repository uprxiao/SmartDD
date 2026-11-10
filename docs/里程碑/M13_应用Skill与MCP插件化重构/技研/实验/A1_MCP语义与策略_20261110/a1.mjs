// A1：MCP 转换 v2（中间表示＋启动时求值＋包装脚本）与审批矩阵。全部离线：模拟模型主动发起工具调用。
import http from 'node:http';import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,realpathSync} from 'node:fs';import {join} from 'node:path';
const D='/tmp/m13-a1',WRAP=D+'/wy-mcp-launch.sh',PROBE=D+'/probe-server.mjs',CODEX='/Users/liubu/.local/bin/codex';
const root=realpathSync(mkdtempSync('/tmp/m13-a1-run-'));const LOG=join(root,'probe.log');writeFileSync(LOG,'');
const SECRET={SRC:'SRCVAL',HTTP_TOK:'http-secret-'+Math.random().toString(36).slice(2),KEY_A:'key-a-'+Math.random().toString(36).slice(2),KEY_B:'key-b-'+Math.random().toString(36).slice(2)};
const MODEL_TOKEN='model-token-'+Math.random().toString(36).slice(2);
const logs=()=>readFileSync(LOG,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
// ---- fake http MCP reporting headers
const hlog=[];const hs=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{let m={};try{m=JSON.parse(Buffer.concat(c))}catch{}
 hlog.push({path:q.url,auth:q.headers.authorization??null,xpart:q.headers['x-part']??null,xlit:q.headers['x-lit']??null,method:m.method});
 if(m.id===undefined){r.writeHead(202);r.end();return;}let result={};
 if(m.method==='initialize')result={protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'h',version:'1'}};
 else if(m.method==='tools/list')result={tools:[{name:'wy_echo',description:'e',inputSchema:{type:'object',properties:{}}}]};
 else if(m.method==='tools/call')result={content:[{type:'text',text:'HTTP CALLED'}]};
 r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});});
await new Promise(x=>hs.listen(0,'127.0.0.1',x));const HURL=`http://127.0.0.1:${hs.address().port}/mcp`;
// ---- mock models: prompt "CALL <server> <tool>" -> call it once, then finish
let mlog=[];const want=t=>{const m=/CALL ([A-Za-z0-9_-]+) ([A-Za-z0-9_-]+)/.exec(t);return m?{server:m[1],tool:m[2]}:null};
const anth=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{if(!q.url.startsWith('/v1/messages')||q.url.includes('count')){r.writeHead(404);r.end('{}');return;}
 const b=JSON.parse(Buffer.concat(c));const msgs=b.messages||[];const last=msgs.at(-1);const w=want(JSON.stringify(msgs[0]?.content));
 const tr=Array.isArray(last?.content)?last.content.find(x=>x.type==='tool_result'):null;const names=(b.tools||[]).map(t=>t.name);
 mlog.push({api:'anthropic',listed:names.filter(n=>n.startsWith('mcp__')),toolResult:tr?String(typeof tr.content==='string'?tr.content:(tr.content||[]).map(x=>x.text).join('')).slice(0,160):null,isError:tr?.is_error??null});
 const blk=tr||!w?{type:'text',text:'DONE'}:{type:'tool_use',id:'toolu_1',name:`mcp__${w.server}__${w.tool}`,input:{}};
 r.writeHead(200,{'content-type':'text/event-stream'});const e=(t,d)=>r.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);
 e('message_start',{message:{id:'m',type:'message',role:'assistant',model:b.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
 if(blk.type==='text'){e('content_block_start',{index:0,content_block:{type:'text',text:''}});e('content_block_delta',{index:0,delta:{type:'text_delta',text:blk.text}});}
 else{e('content_block_start',{index:0,content_block:{...blk,input:{}}});e('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:'{}'}});}
 e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:blk.type==='text'?'end_turn':'tool_use'},usage:{output_tokens:1}});e('message_stop',{});r.end();});});
const resp=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{if(!q.url.endsWith('/responses')){r.writeHead(404);r.end();return;}
 const b=JSON.parse(Buffer.concat(c));const input=b.input||[];const out=input.find(x=>x.type==='function_call_output');const w=want(JSON.stringify(input.filter(x=>x.role==='user')));
 const tools=(b.tools||[]).flatMap(t=>t.type==='namespace'?(t.tools||[]).map(x=>({...x,ns:t.name})):[t]);
 mlog.push({api:'responses',listed:tools.filter(t=>t.ns?.startsWith('mcp__')).map(t=>t.ns+'::'+t.name),toolResult:out?String(typeof out.output==='string'?out.output:JSON.stringify(out.output)).slice(0,200):null});
 const tool=w&&tools.find(t=>t.ns===`mcp__${w.server}`&&t.name===w.tool);
 const item=out||!w?{id:'msg',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'DONE',annotations:[]}]}
  :{id:'fc',type:'function_call',status:'completed',call_id:'call_1',name:w.tool,namespace:`mcp__${w.server}`,arguments:'{}'};
 if(w&&!tool&&!out)mlog.at(-1).forcedUnlisted=true;
 r.writeHead(200,{'content-type':'text/event-stream'});const s=(t,d)=>r.write('event: '+t+'\ndata: '+JSON.stringify({type:t,...d})+'\n\n');
 s('response.created',{response:{id:'r',status:'in_progress',output:[]}});s('response.output_item.done',{output_index:0,item});
 s('response.completed',{response:{id:'r',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});r.end();});});
await new Promise(x=>anth.listen(0,'127.0.0.1',x));await new Promise(x=>resp.listen(0,'127.0.0.1',x));
// ---- canonical model
// value: {lit:string} | {tpl:[{text}|{ref,default?}]}
const parseClaude=s=>{const parts=[];let i=0;const re=/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;let m;while((m=re.exec(s))){if(m.index>i)parts.push({text:s.slice(i,m.index)});parts.push({ref:m[1],...(m[2]!==undefined?{default:m[2]}:{})});i=re.lastIndex;}if(i<s.length)parts.push({text:s.slice(i)});return parts.some(p=>p.ref)?{tpl:parts}:{lit:s};};
const lit=s=>({lit:s}),ref=n=>({tpl:[{ref:n}]});
function fromClaude(name,v){const t=v.type||'stdio';if(t==='stdio')return {name,transport:'stdio',command:v.command,args:(v.args||[]).map(parseClaude),env:Object.fromEntries(Object.entries(v.env||{}).map(([k,x])=>[k,parseClaude(x)])),cwd:null};
 return {name,transport:t,url:v.url,headers:Object.fromEntries(Object.entries(v.headers||{}).map(([k,x])=>[k,parseClaude(x)]))};}
function fromCodex(name,v){if(v.url){const h=Object.fromEntries(Object.entries(v.http_headers||{}).map(([k,x])=>[k,lit(x)]));for(const[k,x]of Object.entries(v.env_http_headers||{}))h[k]=ref(x);if(v.bearer_token_env_var)h.Authorization={tpl:[{text:'Bearer '},{ref:v.bearer_token_env_var}]};return {name,transport:'http',url:v.url,headers:h};}
 const env=Object.fromEntries(Object.entries(v.env||{}).map(([k,x])=>[k,lit(x)]));for(const n of v.env_vars||[])env[typeof n==='string'?n:n.name]=ref(typeof n==='string'?n:n.name);
 return {name,transport:'stdio',command:v.command,args:(v.args||[]).map(lit),env,cwd:v.cwd??null};}
const evalv=(v,src)=>{if('lit' in v)return {ok:true,value:v.lit};let o='';for(const p of v.tpl){if(p.text!==undefined)o+=p.text;else if(src[p.ref]!==undefined)o+=src[p.ref];else if(p.default!==undefined)o+=p.default;else return {ok:false,missing:p.ref};}return {ok:true,value:o};};
// ---- emit for target, returns {claudeJson|codexArgs, env (process env additions), problems}
function emit(servers,target,{launchEnv,strip}){const add={},problems=[];let n=0;const slot=val=>{const k='WY_MCPV_'+(++n);add[k]=val;return k;};const claude={mcpServers:{}},codex=[];
 for(const s of servers){if(s.transport==='sse'&&target==='codex'){problems.push(s.name+': sse 不支持');continue;}
  if(s.transport==='stdio'){const wa=[WRAP];if(s.cwd)wa.push('--cwd',s.cwd);const own=[];
   for(const[k,v]of Object.entries(s.env)){const r=evalv(v,launchEnv);if(!r.ok){problems.push(`${s.name}: 缺少变量 ${r.missing}`);continue;}const sk=slot(r.value);own.push(sk);wa.push('--set',`${k}=${sk}`);}
   const args=[];for(const a of s.args){const r=evalv(a,launchEnv);if(!r.ok){problems.push(`${s.name}: 缺少变量 ${r.missing}`);continue;}if(/\$/.test(r.value)||'tpl' in a){const sk=slot(r.value);own.push(sk);args.push('@WYARG:'+sk);}else args.push(r.value);}
   for(const x of strip)wa.push('--unset',x);wa.push('--unset-prefix','WY_MCPV_','--',s.command,...args);
   if(target==='claude')claude.mcpServers[s.name]={type:'stdio',command:'/bin/sh',args:wa,env:{}};
   else codex.push('-c',`mcp_servers.${s.name}={command="/bin/sh",args=${JSON.stringify(wa)},env_vars=${JSON.stringify(own)}}`);}
  else{const hh={};for(const[k,v]of Object.entries(s.headers)){const r=evalv(v,launchEnv);if(!r.ok){problems.push(`${s.name}: 缺少变量 ${r.missing}`);continue;}hh[k]=slot(r.value);}
   if(target==='claude')claude.mcpServers[s.name]={type:'http',url:s.url,headers:Object.fromEntries(Object.entries(hh).map(([k,x])=>[k,'${'+x+'}']))};
   else codex.push('-c',`mcp_servers.${s.name}={url=${JSON.stringify(s.url)},env_http_headers={${Object.entries(hh).map(([k,x])=>`${JSON.stringify(k)}=${JSON.stringify(x)}`).join(',')}}}`);}}
 return {claude,codex,add,problems};}
// ---- runners
const noNet={HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
const out={cases:{}};let seq=0;
function run(target,{prompt,claudeJson,codexArgs=[],add={},claudeFlags=[],nativeClaudeJson,label}){return new Promise(res=>{const lb=logs().length,mb=mlog.length,hb=hlog.length;const id=++seq;const pd=join(root,'p'+id);mkdirSync(pd);
 let cmd,args,env;if(target==='claude'){const cfg=join(root,'cc'+id);mkdirSync(cfg);const f=join(root,`mcp-${id}.json`);writeFileSync(f,JSON.stringify(claudeJson,null,1));
  cmd='claude';args=['-p','--output-format','json','--mcp-config',f,'--strict-mcp-config',...claudeFlags,'--model','m',prompt];
  env={PATH:process.env.PATH,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:`http://127.0.0.1:${anth.address().port}`,ANTHROPIC_AUTH_TOKEN:MODEL_TOKEN,WILLYOU_RUN_TOKEN:'run-token-x',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',...noNet,...SECRET,WY_PROBE_LOG:LOG,...add};}
 else{const ch=join(root,'ch'+id);mkdirSync(ch);mkdirSync(join(ch,'h'));cmd=CODEX;args=['exec','--skip-git-repo-check','--json','-c','analytics.enabled=false','-c','approval_policy="never"','-c','sandbox_mode="read-only"','-c','model_provider="m"','-c',`model_providers.m={name="m",base_url="http://127.0.0.1:${resp.address().port}/v1",wire_api="responses",env_key="WY_MODEL_KEY"}`,'-m','mock',...codexArgs,prompt];
  env={PATH:process.env.PATH,HOME:join(ch,'h'),CODEX_HOME:ch,WY_MODEL_KEY:MODEL_TOKEN,WILLYOU_RUN_TOKEN:'run-token-x',...noNet,...SECRET,WY_PROBE_LOG:LOG,...add};}
 const c=spawn(cmd,args,{cwd:pd,env,stdio:['ignore','pipe','pipe']});let se='';c.stderr.on('data',b=>se+=b);c.stdout.on('data',()=>{});const k=setTimeout(()=>c.kill('SIGTERM'),90000);
 c.on('close',code=>{clearTimeout(k);const L=logs().slice(lb);const r={target,code,starts:L.filter(x=>x.kind==='start').map(x=>({argv:x.argv,cwd:x.cwd.replace(root,'<root>'),env:x.env})),calls:L.filter(x=>x.kind==='call').map(x=>x.tool),http:hlog.slice(hb).filter(x=>x.method==='initialize'||x.method==='tools/call'),model:mlog.slice(mb),stderr:se.split('\n').filter(l=>l&&!/unrecognized_model|Reading additional/.test(l)).slice(-2).map(l=>l.slice(0,200)),argvHasSecret:Object.values(SECRET).filter(v=>v!=='SRCVAL').some(v=>args.join(' ').includes(v)),configHasSecret:target==='claude'?Object.values(SECRET).filter(v=>v!=='SRCVAL').some(v=>JSON.stringify(claudeJson).includes(v)):null};
  out.cases[label]=r;res(r);});});}
const STRIP={claude:['ANTHROPIC_AUTH_TOKEN','ANTHROPIC_API_KEY','ANTHROPIC_BASE_URL','WILLYOU_RUN_TOKEN'],codex:['WY_MODEL_KEY','WILLYOU_RUN_TOKEN']};
// ==== M1 semantics: Claude-source native vs converted to Codex
const claudeSrc={p1:{command:'node',args:[PROBE,'arg-${SRC}','lit-$x','${NOPE:-dflt}'],env:{A_FULL:'${SRC}',B_PART:'pre-${SRC}-post',C_LIT:'plain',D_DOLLAR:'cost $5 and $HOME',API_KEY:'${KEY_A}',WY_PROBE_LOG:LOG}},h1:{type:'http',url:HURL,headers:{Authorization:'Bearer ${HTTP_TOK}','X-Part':'t-${SRC}'}}};
await run('claude',{label:'M1a_claudeSrc_native_claude',claudeFlags:['--allowedTools','mcp__h1__wy_echo'],claudeJson:{mcpServers:Object.fromEntries(Object.entries(claudeSrc).map(([k,v])=>[k,{type:v.type||'stdio',...v}]))},prompt:'CALL h1 wy_echo'});
const canonC=Object.entries(claudeSrc).map(([k,v])=>fromClaude(k,v));
const toCodex=emit(canonC,'codex',{launchEnv:{...SECRET,WY_PROBE_LOG:LOG},strip:STRIP.codex});out.emit_claude_to_codex={codexArgs:toCodex.codex.map(a=>Object.values(SECRET).filter(v=>v!=='SRCVAL').reduce((s,v)=>s.replaceAll(v,'<secret>'),a)),addKeys:Object.keys(toCodex.add),problems:toCodex.problems};
await run('codex',{label:'M1b_claudeSrc_converted_codex',codexArgs:toCodex.codex,add:toCodex.add,prompt:'CALL h1 wy_echo'});
// ==== M1 reverse: Codex-source native vs converted to Claude
const codexSrc={p2:{command:'node',args:[PROBE,'arg-${SRC}'],env:{A_FULL:'${SRC}',C_LIT:'plain',WY_PROBE_LOG:LOG},env_vars:['SRC','KEY_B']},h2:{url:HURL,bearer_token_env_var:'HTTP_TOK',http_headers:{'X-Lit':'${SRC}'}}};
const tomlv=v=>Array.isArray(v)?'['+v.map(tomlv).join(',')+']':typeof v==='object'?'{'+Object.entries(v).map(([k,x])=>JSON.stringify(k)+'='+tomlv(x)).join(',')+'}':JSON.stringify(v);
await run('codex',{label:'M1c_codexSrc_native_codex',codexArgs:Object.entries(codexSrc).flatMap(([k,v])=>['-c',`mcp_servers.${k}=${tomlv(v)}`]),prompt:'CALL h2 wy_echo'});
const canonX=Object.entries(codexSrc).map(([k,v])=>fromCodex(k,v));
const toClaude=emit(canonX,'claude',{launchEnv:{...SECRET,WY_PROBE_LOG:LOG},strip:STRIP.claude});out.emit_codex_to_claude={claudeJson:JSON.parse(Object.values(SECRET).filter(v=>v!=='SRCVAL').reduce((s,v)=>s.replaceAll(v,'<secret>'),JSON.stringify(toClaude.claude))),addKeys:Object.keys(toClaude.add)};
await run('claude',{label:'M1d_codexSrc_converted_claude',claudeFlags:['--allowedTools','mcp__h2__wy_echo'],claudeJson:toClaude.claude,add:toClaude.add,prompt:'CALL h2 wy_echo'});
// ==== M2 collision + M4 cwd
const coll=[{name:'ca',transport:'stdio',command:'node',args:[lit(PROBE),lit('ca')].map(x=>x),env:{API_KEY:ref('KEY_A'),WY_PROBE_LOG:lit(LOG)},cwd:join(root,"cwd with space 'q' $x")},{name:'cb',transport:'stdio',command:'node',args:[lit(PROBE),lit('cb')],env:{API_KEY:ref('KEY_B'),WY_PROBE_LOG:lit(LOG)},cwd:null}];
mkdirSync(join(root,"cwd with space 'q' $x"));
for(const t of ['claude','codex']){const e=emit(coll,t,{launchEnv:{...SECRET},strip:STRIP[t]});await run(t,{label:`M2_collision_cwd_${t}`,claudeFlags:['--allowedTools','mcp__ca__wy_echo'],claudeJson:e.claude,codexArgs:e.codex,add:e.add,prompt:'CALL ca wy_echo'});}
// ==== M3 missing variable
{const e=emit([{name:'mv',transport:'stdio',command:'node',args:[lit(PROBE)],env:{X:ref('NOT_SET')}}],'claude',{launchEnv:{},strip:[]});out.M3_missing_var=e.problems;}
// ==== M6 approval matrix (probe server has wy_echo + wy_write)
const ap=(extra)=>['-c',`mcp_servers.pa={command="node",args=${JSON.stringify([PROBE,'pa'])},env={WY_PROBE_LOG=${JSON.stringify(LOG)}}${extra}}`];
await run('codex',{label:'M6c1_codex_default_noninteractive',codexArgs:ap(''),prompt:'CALL pa wy_echo'});
await run('codex',{label:'M6c2_codex_server_approve',codexArgs:ap(',default_tools_approval_mode="approve"'),prompt:'CALL pa wy_echo'});
await run('codex',{label:'M6c3_codex_approve_but_write_prompt__echo',codexArgs:ap(',default_tools_approval_mode="approve",tools={wy_write={approval_mode="prompt"}}'),prompt:'CALL pa wy_echo'});
await run('codex',{label:'M6c4_codex_approve_but_write_prompt__write',codexArgs:ap(',default_tools_approval_mode="approve",tools={wy_write={approval_mode="prompt"}}'),prompt:'CALL pa wy_write'});
await run('codex',{label:'M6c5_codex_disabled_write',codexArgs:ap(',default_tools_approval_mode="approve",disabled_tools=["wy_write"]'),prompt:'CALL pa wy_write'});
const cj={mcpServers:{pa:{type:'stdio',command:'node',args:[PROBE,'pa'],env:{WY_PROBE_LOG:LOG}}}};
await run('claude',{label:'M6a1_claude_default_noninteractive',claudeJson:cj,prompt:'CALL pa wy_echo'});
await run('claude',{label:'M6a2_claude_allowed_echo',claudeJson:cj,claudeFlags:['--allowedTools','mcp__pa__wy_echo'],prompt:'CALL pa wy_echo'});
await run('claude',{label:'M6a3_claude_allowed_echo__write',claudeJson:cj,claudeFlags:['--allowedTools','mcp__pa__wy_echo'],prompt:'CALL pa wy_write'});
await run('claude',{label:'M6a4_claude_disallowed_write',claudeJson:cj,claudeFlags:['--allowedTools','mcp__pa__wy_echo','mcp__pa__wy_write','--disallowedTools','mcp__pa__wy_write'],prompt:'CALL pa wy_write'});
hs.close();anth.close();resp.close();
let txt=JSON.stringify(out,null,1).replaceAll(root,'<root>').replaceAll(MODEL_TOKEN,'<model-token>');for(const[k,v]of Object.entries(SECRET))if(k!=='SRC')txt=txt.replaceAll(v,`<${k}>`);
writeFileSync(join(root,'result.json'),txt);console.log(txt);
