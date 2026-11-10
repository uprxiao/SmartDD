import http from 'node:http';import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
const D='/tmp/m13-mcp-driver';const root=mkdtempSync('/tmp/m13-mcp-');const proj=join(root,'proj'),srvcwd=join(root,'server-cwd');mkdirSync(proj);mkdirSync(srvcwd);
const LOG=join(root,'mcp-calls.log');writeFileSync(LOG,'');const HTTP_TOKEN='wy-http-'+Math.random().toString(36).slice(2);
const sha=p=>existsSync(p)?createHash('sha256').update(readFileSync(p)).digest('hex'):null;
const G={codex:sha(process.env.HOME+'/.codex/config.toml'),claudeSettings:sha(process.env.HOME+'/.claude/settings.json'),claudeJson:sha(process.env.HOME+'/.claude.json')};
// fake http MCP
const hp=spawn('node',[D+'/fake-mcp-http.mjs',LOG,HTTP_TOKEN],{stdio:['ignore','pipe','inherit']});const HPORT=await new Promise(r=>hp.stdout.once('data',b=>r(String(b).trim())));
const HTTP_URL=`http://127.0.0.1:${HPORT}/mcp`;
const readLog=()=>readFileSync(LOG,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
// ---------- mock models: call tool whose name contains TARGET (from prompt), then finish
let modelLog=[];
const pickTarget=t=>/HTTP/.test(t)?'wyhttp':'wystdio';
const anth=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{if(!q.url.startsWith('/v1/messages')||q.url.includes('count')){r.writeHead(404);r.end('{}');return;}
 const b=JSON.parse(Buffer.concat(c));const names=(b.tools||[]).map(t=>t.name);const msgs=b.messages||[];const last=msgs[msgs.length-1];
 const firstUser=JSON.stringify(msgs[0]?.content);const target=pickTarget(firstUser);
 const tr=Array.isArray(last?.content)?last.content.find(x=>x.type==='tool_result'):null;
 const tool=names.find(n=>n.includes(target)&&n.includes('wy_echo'));
 modelLog.push({api:'anthropic',mcpTools:names.filter(n=>n.startsWith('mcp__')),target,picked:tr?null:tool??null,gotToolResult:!!tr});
 let content;if(tr){const txt=typeof tr.content==='string'?tr.content:(tr.content||[]).map(x=>x.text).join('');content=[{type:'text',text:'DONE '+txt.slice(0,300)}];}
 else if(tool)content=[{type:'tool_use',id:'toolu_1',name:tool,input:{}}];else content=[{type:'text',text:'NO_TOOL '+names.filter(n=>n.startsWith('mcp__')).join(',')}];
 const stop=content[0].type==='tool_use'?'tool_use':'end_turn';
 r.writeHead(200,{'content-type':'text/event-stream'});const e=(t,d)=>r.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);
 e('message_start',{message:{id:'m',type:'message',role:'assistant',model:b.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
 const blk=content[0];if(blk.type==='text'){e('content_block_start',{index:0,content_block:{type:'text',text:''}});e('content_block_delta',{index:0,delta:{type:'text_delta',text:blk.text}});}
 else{e('content_block_start',{index:0,content_block:{type:'tool_use',id:blk.id,name:blk.name,input:{}}});e('content_block_delta',{index:0,delta:{type:'input_json_delta',partial_json:'{}'}});}
 e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:stop},usage:{output_tokens:1}});e('message_stop',{});r.end();});});
const resp=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{if(!q.url.endsWith('/responses')){r.writeHead(404);r.end();return;}
 const b=JSON.parse(Buffer.concat(c));const flat=t=>t.type==='namespace'?(t.tools||[]).map(x=>({...x,ns:t.name})):[t];const tools=(b.tools||[]).flatMap(flat);
 const names=tools.map(t=>(t.ns?t.ns+'::':'')+(t.name||t.type));const input=b.input||[];const out=input.find(x=>x.type==='function_call_output');
 const target=pickTarget(JSON.stringify(input.filter(x=>x.role==='user')));const tool=tools.find(t=>((t.ns||'')+(t.name||'')).includes(target)&&(t.name||'').includes('wy_echo'));
 modelLog.push({api:'responses',toolNames:names.filter(n=>/wy|mcp/i.test(n)),target,picked:out?null:(tool?((tool.ns?tool.ns+'::':'')+tool.name):null),gotOutput:!!out});
 let item;if(out)item={id:'msg_1',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'DONE '+String(typeof out.output==='string'?out.output:JSON.stringify(out.output)).slice(0,300),annotations:[]}]};
 else if(tool)item={id:'fc_1',type:'function_call',status:'completed',call_id:'call_1',name:tool.name,...(tool.ns?{namespace:tool.ns}:{}),arguments:'{}'};
 else item={id:'msg_1',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'NO_TOOL',annotations:[]}]};
 r.writeHead(200,{'content-type':'text/event-stream'});const s=(t,d)=>r.write('event: '+t+'\ndata: '+JSON.stringify({type:t,...d})+'\n\n');
 s('response.created',{response:{id:'r',status:'in_progress',output:[]}});s('response.output_item.done',{output_index:0,item});
 s('response.completed',{response:{id:'r',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});r.end();});});
await new Promise(x=>anth.listen(0,'127.0.0.1',x));await new Promise(x=>resp.listen(0,'127.0.0.1',x));
const noNet={HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
const SECRET_ENV={WY_PASS:'passed-through',WY_HTTP_TOKEN:HTTP_TOKEN};
const proc=(cmd,args,env,label)=>new Promise(res=>{const lb=readLog().length,mb=modelLog.length;const c=spawn(cmd,args,{cwd:proj,env,stdio:['ignore','pipe','pipe']});let so='',se='';c.stdout.on('data',b=>so+=b);c.stderr.on('data',b=>se+=b);const k=setTimeout(()=>c.kill('SIGTERM'),120000);
 c.on('close',code=>{clearTimeout(k);const fin=(so.match(/DONE[^"\\]*/)||so.match(/NO_TOOL[^"\\]*/)||[null])[0];res(out.cases[label]={code,final:fin&&fin.slice(0,200),mcpLog:readLog().slice(lb),model:modelLog.slice(mb),stderr:se.split('\n').filter(l=>l&&!/Reading additional/.test(l)).slice(-3).map(l=>l.slice(0,220))});});});
const out={cases:{}};
// ===== Source A: Codex format
const stdioArgs=[D+'/fake-mcp-stdio.mjs',LOG];
const codexSrc={wystdio:{command:'node',args:stdioArgs,env:{WY_STATIC:'static-val'},env_vars:['WY_PASS'],cwd:srvcwd,startup_timeout_sec:20,tool_timeout_sec:30},wyhttp:{url:HTTP_URL,bearer_token_env_var:'WY_HTTP_TOKEN'},wyoff:{command:'false',enabled:false}};
// convert Codex -> Claude
function codexToClaude(src,{cwdMode}){const o={},notes=[];for(const[k,v]of Object.entries(src)){if(v.enabled===false){notes.push(k+': enabled=false 跳过');continue;}
 if(v.url){const h={...(v.http_headers||{})};if(v.bearer_token_env_var)h.Authorization='Bearer ${'+v.bearer_token_env_var+'}';for(const[hk,ev]of Object.entries(v.env_http_headers||{}))h[hk]='${'+ev+'}';o[k]={type:'http',url:v.url,...(Object.keys(h).length?{headers:h}:{})};}
 else{const env={...(v.env||{})};for(const n of v.env_vars||[])env[n]='${'+n+'}';let command=v.command,args=v.args||[];
  if(v.cwd&&cwdMode==='wrap'){args=['-c','cd "$0" && exec "$@"',v.cwd,command,...args];command='/bin/sh';}
  o[k]={type:'stdio',command,args,env,...(v.cwd&&cwdMode==='field'?{cwd:v.cwd}:{})};}
 for(const f of ['startup_timeout_sec','tool_timeout_sec'])if(v[f])notes.push(k+': '+f+' 无逐服务器对应');}
 return {mcpServers:o,notes};}
const claudeBase=(cfg,extra={})=>({PATH:process.env.PATH,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:`http://127.0.0.1:${anth.address().port}`,ANTHROPIC_AUTH_TOKEN:'tok',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',...noNet,...extra});
for(const cwdMode of ['field','wrap']){const cfg=join(root,'claude-cfg-'+cwdMode);mkdirSync(cfg);const conv=codexToClaude(codexSrc,{cwdMode});const f=join(root,`claude-mcp-${cwdMode}.json`);writeFileSync(f,JSON.stringify({mcpServers:conv.mcpServers},null,1));out['conv_codex_to_claude_'+cwdMode]=conv;
 for(const t of ['STDIO','HTTP'])await proc('claude',['-p','--output-format','json','--mcp-config',f,'--strict-mcp-config','--allowedTools','mcp__wystdio__wy_echo','mcp__wyhttp__wy_echo','--model','m',`调用 ${t} 工具`],claudeBase(cfg,SECRET_ENV),`A_codex2claude_${cwdMode}_${t}`);}
// Claude: does stdio server inherit parent env without explicit mapping?
{const cfg=join(root,'claude-cfg-inherit');mkdirSync(cfg);const f=join(root,'claude-mcp-inherit.json');writeFileSync(f,JSON.stringify({mcpServers:{wystdio:{type:'stdio',command:'node',args:stdioArgs}}}));
 await proc('claude',['-p','--output-format','json','--mcp-config',f,'--strict-mcp-config','--allowedTools','mcp__wystdio__wy_echo','--model','m','调用 STDIO 工具'],claudeBase(cfg,SECRET_ENV),'A_claude_inherit_env_STDIO');}
// ===== Source B: Claude format
const claudeSrc={mcpServers:{wystdio:{command:'node',args:stdioArgs,env:{WY_STATIC:'static-val'}},wyhttp:{type:'http',url:HTTP_URL,headers:{Authorization:'Bearer ${WY_HTTP_TOKEN}'}}}};
function claudeToCodex(src,{passEnv}){const args=[],notes=[];const toml=v=>JSON.stringify(v);
 for(const[k,v]of Object.entries(src.mcpServers)){const t=v.type||'stdio';
  if(t==='http'||t==='sse'){if(t==='sse')notes.push(k+': sse 传输 Codex 不支持');const parts=[`url=${toml(v.url)}`];const plain={},envh={};
   for(const[hk,hv]of Object.entries(v.headers||{})){const m=/^Bearer \$\{(\w+)\}$/.exec(hv);const m2=/^\$\{(\w+)\}$/.exec(hv);if(hk.toLowerCase()==='authorization'&&m)parts.push(`bearer_token_env_var=${toml(m[1])}`);else if(m2)envh[hk]=m2[1];else plain[hk]=hv;}
   if(Object.keys(plain).length)parts.push('http_headers={'+Object.entries(plain).map(([a,b])=>`${toml(a)}=${toml(b)}`).join(',')+'}');
   if(Object.keys(envh).length)parts.push('env_http_headers={'+Object.entries(envh).map(([a,b])=>`${toml(a)}=${toml(b)}`).join(',')+'}');
   args.push('-c',`mcp_servers.${k}={${parts.join(',')}}`);}
  else{const env=v.env||{};const parts=[`command=${toml(v.command)}`,`args=${toml(v.args||[])}`];if(Object.keys(env).length)parts.push('env={'+Object.entries(env).map(([a,b])=>`${toml(a)}=${toml(b)}`).join(',')+'}');if(passEnv.length)parts.push(`env_vars=${toml(passEnv)}`);args.push('-c',`mcp_servers.${k}={${parts.join(',')}}`);}}
 return {args,notes};}
const codexEnv=ch=>({PATH:process.env.PATH,HOME:join(root,'codex-home-'+ch.split('-').pop()),CODEX_HOME:ch,...noNet,...SECRET_ENV,WY_MOCK_KEY:'k'});
const codexCommon=['exec','--skip-git-repo-check','--json','-c','analytics.enabled=false','-c','feedback.enabled=false','-c','approval_policy="never"','-c','sandbox_mode="read-only"','-c','model_provider="wymock"','-c',`model_providers.wymock={name="m",base_url="http://127.0.0.1:${resp.address().port}/v1",wire_api="responses",env_key="WY_MOCK_KEY"}`,'-m','mock-model'];
for(const passEnv of [[],['WY_PASS']]){const ch=join(root,'codex-ch-'+(passEnv.length?'pass':'nopass'));mkdirSync(ch);mkdirSync(join(root,'codex-home-'+(passEnv.length?'pass':'nopass')));writeFileSync(join(ch,'config.toml'),'');
 const conv=claudeToCodex(claudeSrc,{passEnv});out['conv_claude_to_codex_'+(passEnv.length?'pass':'nopass')]=conv;
 for(const t of (passEnv.length?['STDIO','HTTP']:['STDIO']))await proc('/Users/liubu/.local/bin/codex',[...codexCommon,...conv.args,`调用 ${t} 工具`],codexEnv(ch),`B_claude2codex_${passEnv.length?'envvars':'noenvvars'}_${t}`);}
hp.kill();anth.close();resp.close();
out.globalsUnchanged={codex:sha(process.env.HOME+'/.codex/config.toml')===G.codex,claudeSettings:sha(process.env.HOME+'/.claude/settings.json')===G.claudeSettings,claudeJson:sha(process.env.HOME+'/.claude.json')===G.claudeJson};
out.srvcwd='<root>/server-cwd';
const txt=JSON.stringify(out,null,1).replaceAll(root,'<root>').replaceAll(HTTP_TOKEN,'<http-token>');writeFileSync(join(root,'result.json'),txt);console.log(txt);
