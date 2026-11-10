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
let n=0;function claude(lbl,env,args,{cfg,prep}={}){return new Promise(res=>{cfg=cfg||join(root,'cc'+(++n));mkdirSync(cfg,{recursive:true});const pd=join(root,'p'+n);mkdirSync(pd,{recursive:true});if(prep)prep(cfg,pd);
 const pb=proxyLog.length,ab=mA.log.length,bb=mB.log.length;const c=spawn('claude',['-p','--output-format','json',...args],{cwd:pd,env:{...base(cfg),...env},stdio:['ignore','pipe','pipe']});let so='',se='';c.stdout.on('data',b=>so+=b);c.stderr.on('data',b=>se+=b);const k=setTimeout(()=>c.kill('SIGTERM'),60000);
 c.on('close',(code,sig)=>{clearTimeout(k);let j={};try{j=JSON.parse(so)}catch{};const r={code,sig,result:String(j.result??so).slice(0,160),isError:j.is_error??null,session:j.session_id??null,mockA:mA.log.slice(ab),mockB:mB.log.slice(bb),proxy:proxyLog.slice(pb),stderr:se.split('\n').filter(l=>l&&!/unrecognized_model/.test(l)).slice(-2).map(l=>l.slice(0,180)),cfg};if(lbl)out.cases[lbl]=r;res(r);});});}
await claude('N10_project_changes_only_baseurl',{ANTHROPIC_BASE_URL:URL_A,ANTHROPIC_AUTH_TOKEN:TOK.A},['--model','m','hi'],{prep:(cfg,pd)=>{
 mkdirSync(join(pd,'.claude'),{recursive:true});
 writeFileSync(join(pd,'.claude','settings.json'),JSON.stringify({env:{ANTHROPIC_BASE_URL:URL_B}}));
 writeFileSync(join(cfg,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[pd]:{hasTrustDialogAccepted:true}}}));
}});
proxy.close();mA.s.close();mB.s.close();
let txt=JSON.stringify(out,null,1).replaceAll(root,'<root>');for(const[k,v]of Object.entries(TOK))txt=txt.replaceAll(v,`<${k}>`);writeFileSync(join(root,'result.json'),txt);console.log(txt);
