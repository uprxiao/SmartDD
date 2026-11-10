// 补验 B6（审核二 F07-A1）：Claude http MCP 字面量请求头（值含 "${"）的最终对照。旧红＝headers 直写被展开；
// 新绿＝headersHelper（A1 hh.sh 原件）原样输出。并检查第三方运行新规则 --setting-sources user 下仍生效、无信任时不执行。
import http from 'node:http';import {spawn} from 'node:child_process';import {mkdtempSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));const HH=join(here,'../A1_MCP语义与策略_20261110/hh.sh');
const root=realpathSync(mkdtempSync('/tmp/m13-b6-'));const out={cases:{}};
const hlog=[];const hs=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{let m={};try{m=JSON.parse(Buffer.concat(c))}catch{}
 hlog.push({xlit:q.headers['x-lit']??null,method:m.method??null});if(m.id===undefined){r.writeHead(202);r.end();return;}let result={};
 if(m.method==='initialize')result={protocolVersion:m.params?.protocolVersion||'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'h',version:'1'}};else if(m.method==='tools/list')result={tools:[]};
 r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});});
await new Promise(x=>hs.listen(0,'127.0.0.1',x));const HURL=`http://127.0.0.1:${hs.address().port}/mcp`;
const anth=http.createServer((q,r)=>{q.resume();q.on('end',()=>{if(!q.url.startsWith('/v1/messages')||q.url.includes('count')){r.writeHead(404);r.end('{}');return;}
 r.writeHead(200,{'content-type':'text/event-stream'});const e=(t,d)=>r.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);
 e('message_start',{message:{id:'msg_'+Math.random().toString(36).slice(2),type:'message',role:'assistant',model:'m',content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});e('content_block_start',{index:0,content_block:{type:'text',text:''}});e('content_block_delta',{index:0,delta:{type:'text_delta',text:'OK'}});e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:1}});e('message_stop',{});r.end();});});
await new Promise(x=>anth.listen(0,'127.0.0.1',x));
let n=0;function run(lbl,server,{trust=true,add={}}={}){return new Promise(res=>{const id=++n;const cfg=join(root,'cc'+id),pd=join(root,'p'+id);mkdirSync(cfg);mkdirSync(pd);
 writeFileSync(join(cfg,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:trust?{[pd]:{hasTrustDialogAccepted:true}}:{}}));
 const f=join(root,`mcp-${id}.json`);writeFileSync(f,JSON.stringify({mcpServers:{h:server}}));const hb=hlog.length;
 const c=spawn('claude',['-p','--output-format','json','--setting-sources','user','--mcp-config',f,'--strict-mcp-config','--model','m','hi'],{cwd:pd,env:{PATH:process.env.PATH,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:`http://127.0.0.1:${anth.address().port}`,ANTHROPIC_AUTH_TOKEN:'t',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',HTTPS_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SRC:'SRCVAL',...add},stdio:['ignore','pipe','pipe']});
 let se='';c.stderr.on('data',b=>se+=b);c.stdout.on('data',()=>{});const k=setTimeout(()=>c.kill('SIGTERM'),60000);
 c.on('close',(code,sig)=>{clearTimeout(k);const L=hlog.slice(hb);out.cases[lbl]={code,sig,initialize:L.filter(x=>x.method==='initialize').map(x=>x.xlit),allXlit:[...new Set(L.map(x=>x.xlit))],stderr:se.split('\n').filter(l=>l&&!/unrecognized/.test(l)).slice(-2).map(l=>l.slice(0,200))};res();});});}
// 源：Codex http_headers 字面量 {"X-Lit":"${SRC}"}，源语义要求 MCP 收到字面 ${SRC}
await run('H0_red_headers_direct_literal',{type:'http',url:HURL,headers:{'X-Lit':'${SRC}'}});
await run('H1_slot_reference_literal_value',{type:'http',url:HURL,headers:{'X-Lit':'${WY_MCPV_1}'}},{add:{WY_MCPV_1:'${SRC}'}});
await run('H2_green_headersHelper',{type:'http',url:HURL,headersHelper:`/bin/sh ${HH} '{"X-Lit":"WY_MCPV_1"}'`},{add:{WY_MCPV_1:'${SRC}'}});
await run('H3_headersHelper_untrusted',{type:'http',url:HURL,headersHelper:`/bin/sh ${HH} '{"X-Lit":"WY_MCPV_1"}'`},{trust:false,add:{WY_MCPV_1:'${SRC}'}});
hs.close();anth.close();
const exp={H0_red_headers_direct_literal:'SRCVAL',H2_green_headersHelper:'${SRC}'};
out.judge=Object.fromEntries(Object.entries(out.cases).map(([k,v])=>[k,{code:v.code,xlit:v.allXlit,matchesExpected:exp[k]===undefined?null:v.initialize.length>0&&v.initialize.every(x=>x===exp[k])}]));
console.log(JSON.stringify(out,null,1).replaceAll(root,'<root>'));
