// 补验 B7（审核二 F07-A3）第 1 步：用本机模拟端点生成真实 Claude 原生会话记录（两轮，第二轮 --resume 换模型），
// 模拟端点返回的 model 带 "-srv" 后缀以区分服务端上报模型与请求模型。输出脱敏后的 jsonl 作为最小可复判夹具。
import http from 'node:http';import {spawnSync,spawn} from 'node:child_process';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,realpathSync} from 'node:fs';import {join} from 'node:path';
const root=realpathSync(mkdtempSync('/tmp/m13-b7-'));const cfg=join(root,'cfg'),pd=join(root,'proj');mkdirSync(cfg);mkdirSync(pd);
writeFileSync(join(cfg,'.claude.json'),JSON.stringify({hasCompletedOnboarding:true,projects:{[pd]:{hasTrustDialogAccepted:true}}}));
const s=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{if(!q.url.startsWith('/v1/messages')||q.url.includes('count')){r.writeHead(404);r.end('{}');return;}const b=JSON.parse(Buffer.concat(c));
 r.writeHead(200,{'content-type':'text/event-stream'});const e=(t,d)=>r.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);
 e('message_start',{message:{id:'msg_'+Math.random().toString(36).slice(2),type:'message',role:'assistant',model:b.model+'-srv',content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});e('content_block_start',{index:0,content_block:{type:'text',text:''}});e('content_block_delta',{index:0,delta:{type:'text_delta',text:'OK '+b.model}});e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:1}});e('message_stop',{});r.end();});});
await new Promise(x=>s.listen(0,'127.0.0.1',x));
const env={PATH:process.env.PATH,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:`http://127.0.0.1:${s.address().port}`,ANTHROPIC_AUTH_TOKEN:'t',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',HTTPS_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
const run=args=>new Promise(res=>{const c=spawn('claude',['-p','--output-format','json','--setting-sources','user',...args],{cwd:pd,env,stdio:['ignore','pipe','pipe']});let so='';c.stdout.on('data',b=>so+=b);c.on('close',code=>res({code,j:JSON.parse(so||'{}')}));});
const t1=await run(['--model','model-one','first']);const t2=await run(['--resume',t1.j.session_id,'--model','model-two','second']);s.close();
const files=[];const w=d=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);e.isDirectory()?w(p):p.endsWith('.jsonl')&&files.push(p)}};w(join(cfg,'projects'));
const f=files.find(x=>x.includes(t1.j.session_id))||files[0];
let txt=readFileSync(f,'utf8').replaceAll(root,'<root>').replaceAll(process.env.HOME,'<home>');
writeFileSync(new URL('./b7-fixture-claude-session.jsonl',import.meta.url),txt);
console.log(JSON.stringify({claude:spawnSync('claude',['--version'],{encoding:'utf8'}).stdout.trim(),t1:{code:t1.code,session:t1.j.session_id},t2:{code:t2.code,session:t2.j.session_id},files:files.length,lines:txt.split('\n').filter(Boolean).length},null,1));
