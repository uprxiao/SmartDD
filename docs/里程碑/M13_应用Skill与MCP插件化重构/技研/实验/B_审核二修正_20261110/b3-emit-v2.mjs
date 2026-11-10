// 补验 B3（审核二 F04／F06）：MCP 转换生成器 v2。以服务器为单位完整求值，任一必需变量缺失或 URL 含凭据则整台不生成，
// 已分配的私有槽一并回滚；其他服务器照常生成。纯逻辑，不启动 MCP。中间表示与 evalv 逐字沿用 A1 a1.mjs。
const WRAP='/synthetic/wy-mcp-launch.sh';
const parseClaude=s=>{const parts=[];let i=0;const re=/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;let m;while((m=re.exec(s))){if(m.index>i)parts.push({text:s.slice(i,m.index)});parts.push({ref:m[1],...(m[2]!==undefined?{default:m[2]}:{})});i=re.lastIndex;}if(i<s.length)parts.push({text:s.slice(i)});return parts.some(p=>p.ref)?{tpl:parts}:{lit:s};};
const lit=s=>({lit:s}),ref=n=>({tpl:[{ref:n}]});
const evalv=(v,src)=>{if('lit' in v)return {ok:true,value:v.lit};let o='';for(const p of v.tpl){if(p.text!==undefined)o+=p.text;else if(src[p.ref]!==undefined)o+=src[p.ref];else if(p.default!==undefined)o+=p.default;else return {ok:false,missing:p.ref};}return {ok:true,value:o};};
// F06：带凭据的 URL 不支持转换（需求 R0.3 §敏感值；用户 2026-11-10 决定）
const SENSITIVE_Q=/^(access[_-]?token|token|api[_-]?key|apikey|key|secret|client[_-]?secret|password|passwd|pwd|auth|authorization|sig|signature|code|session|sid|credential)s?$/i;
export function urlCredentialIssue(urlTpl){
 if(typeof urlTpl!=='string')return 'URL 含变量引用';
 if(/\$\{/.test(urlTpl))return 'URL 含变量引用（可能为凭据）';
 let u;try{u=new URL(urlTpl)}catch{return 'URL 无法解析'}
 if(u.username||u.password)return 'URL 含用户名／密码';
 for(const k of u.searchParams.keys())if(SENSITIVE_Q.test(k))return `URL 查询参数 ${k} 疑似凭据`;
 if(/[?&#]/.test(u.hash))return 'URL 片段含参数';
 return null;}
export function emit(servers,target,{launchEnv,strip}){const add={},problems=[],skipped=[];let n=0;const claude={mcpServers:{}},codex=[];
 for(const s of servers){
  if(s.transport==='sse'&&target==='codex'){problems.push(s.name+': sse 不支持');skipped.push(s.name);continue;}
  // 第一遍：整台求值，不分配槽
  const errs=[];const ev=v=>{const r=evalv(v,launchEnv);if(!r.ok)errs.push(`缺少变量 ${r.missing}`);return r;};
  let envR=[],argR=[],hdrR=[];
  if(s.transport==='stdio'){envR=Object.entries(s.env).map(([k,v])=>[k,ev(v)]);argR=s.args.map(a=>[a,ev(a)]);if(/\$\{/.test(s.command))errs.push('command 含 ${ 拒绝');}
  else{const ui=urlCredentialIssue(s.urlRaw??s.url);if(ui)errs.push('不支持转换：'+ui);hdrR=Object.entries(s.headers).map(([k,v])=>[k,ev(v)]);}
  if(errs.length){problems.push(`${s.name}: ${[...new Set(errs)].join('；')}（整台不生成）`);skipped.push(s.name);continue;}
  // 第二遍：全部成功后才分配私有槽并生成
  const slot=val=>{const k='WY_MCPV_'+(++n);add[k]=val;return k;};
  if(s.transport==='stdio'){const wa=[WRAP];if(s.cwd)wa.push('--cwd',s.cwd);const own=[];
   for(const[k,r]of envR){const sk=slot(r.value);own.push(sk);wa.push('--set',`${k}=${sk}`);}
   const args=[];for(const[a,r]of argR){if(/\$/.test(r.value)||'tpl' in a){const sk=slot(r.value);own.push(sk);args.push('@WYARG:'+sk);}else args.push(r.value);}
   for(const x of strip)wa.push('--unset',x);wa.push('--unset-prefix','WY_MCPV_','--',s.command,...args);
   if(target==='claude')claude.mcpServers[s.name]={type:'stdio',command:'/bin/sh',args:wa,env:{}};
   else codex.push('-c',`mcp_servers.${s.name}={command="/bin/sh",args=${JSON.stringify(wa)},env_vars=${JSON.stringify(own)}}`);}
  else{const hh={};for(const[k,r]of hdrR)hh[k]=slot(r.value);
   if(target==='claude')claude.mcpServers[s.name]={type:'http',url:s.url,headers:Object.fromEntries(Object.entries(hh).map(([k,x])=>[k,'${'+x+'}']))};
   else codex.push('-c',`mcp_servers.${s.name}={url=${JSON.stringify(s.url)},env_http_headers={${Object.entries(hh).map(([k,x])=>`${JSON.stringify(k)}=${JSON.stringify(x)}`).join(',')}}}`);}}
 return {claude,codex,add,problems,skipped};}
// ---- 用例
if(import.meta.url===(await import('node:url')).pathToFileURL(process.argv[1]).href){
 const env={KEY:'decoy-key',TOK:'decoy-tok'};const strip=['ANTHROPIC_AUTH_TOKEN'];
 const good={name:'good',transport:'stdio',command:'node',args:[lit('srv.js'),ref('KEY'),lit('tail')],env:{API_KEY:ref('KEY')},cwd:null};
 const missEnv={name:'miss_env',transport:'stdio',command:'node',args:[lit('a')],env:{API_KEY:ref('NOT_SET'),OK:ref('KEY')},cwd:null};
 const missArg={name:'miss_arg',transport:'stdio',command:'node',args:[lit('--token'),ref('NOT_SET'),lit('--port'),lit('9')],env:{},cwd:null};
 const missHdr={name:'miss_hdr',transport:'http',url:'https://mcp.example.test/mcp',headers:{Authorization:{tpl:[{text:'Bearer '},{ref:'NOT_SET'}]}}};
 const dflt={name:'dflt',transport:'stdio',command:'node',args:[parseClaude('${NOT_SET:-fallback}')],env:{},cwd:null};
 const url=(name,u)=>({name,transport:'http',url:u,headers:{Authorization:{tpl:[{text:'Bearer '},{ref:'TOK'}]}}});
 const urls=[url('u_ok','https://mcp.example.test/mcp?region=cn'),url('u_userinfo','https://alice:pw@mcp.example.test/mcp'),url('u_query','https://mcp.example.test/mcp?api_key=abc'),url('u_query2','https://mcp.example.test/mcp?access_token=abc&x=1'),url('u_tpl','https://mcp.example.test/${TOK}/mcp'),url('u_frag','https://mcp.example.test/mcp#token=abc')];
 const all=[good,missEnv,missArg,missHdr,dflt,...urls];const out={};
 for(const t of ['claude','codex']){const e=emit(all,t,{launchEnv:env,strip});
  const present=t==='claude'?Object.keys(e.claude.mcpServers):e.codex.filter((x,i)=>i%2).map(x=>/^mcp_servers\.([^=]+)=/.exec(x)[1]);
  const goodArgs=t==='claude'?e.claude.mcpServers.good.args:null;
  out[t]={present,skipped:e.skipped,problems:e.problems,slots:Object.keys(e.add),slotValues:Object.values(e.add),goodArgsTail:goodArgs?goodArgs.slice(goodArgs.indexOf('--')+1):null};}
 const exp={present:['good','dflt','u_ok'],skipped:['miss_env','miss_arg','miss_hdr','u_userinfo','u_query','u_query2','u_tpl','u_frag']};
 const checks={};for(const t of ['claude','codex']){const o=out[t];checks[t]={presentExact:JSON.stringify(o.present)===JSON.stringify(exp.present),skippedExact:JSON.stringify(o.skipped)===JSON.stringify(exp.skipped),
  noOrphanSlots:o.slots.length===4&&o.slotValues.every(v=>['decoy-key','Bearer decoy-tok','fallback'].includes(v)),noMissingValueLeak:!o.slotValues.includes(undefined)};}
 checks.claude.argOrderIntact=JSON.stringify(out.claude.goodArgsTail)===JSON.stringify(['node','srv.js','@WYARG:WY_MCPV_2','tail']);
 console.log(JSON.stringify({out,checks,allPass:Object.values(checks).every(c=>Object.values(c).every(Boolean))},null,1));}
