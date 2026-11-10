const WRAP='/synthetic/wy-mcp-launch.sh';
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

const input=[{name:'missing',transport:'stdio',command:'node',args:[],env:{API_KEY:ref('NOT_SET')}}];
const out={};for(const t of ['claude','codex'])out[t]=emit(input,t,{launchEnv:{},strip:[]});console.log(JSON.stringify(out,null,2));
