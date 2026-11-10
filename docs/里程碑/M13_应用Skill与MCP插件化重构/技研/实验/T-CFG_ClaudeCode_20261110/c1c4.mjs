import {createServer} from 'node:http';import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync,existsSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';
const root=mkdtempSync('/tmp/m13-cc-'),cfg=join(root,'cfg'),proj=join(root,'proj');mkdirSync(cfg);mkdirSync(proj);
writeFileSync(join(cfg,'settings.json'),JSON.stringify({model:'opus'}));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');const s0=sha(join(cfg,'settings.json'));
const TOKEN='wy-test-token-'+Math.random().toString(36).slice(2);const reqs=[];
const srv=createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{let b={};try{b=JSON.parse(Buffer.concat(c))}catch{}
 const auth=q.headers['authorization']||'',xkey=q.headers['x-api-key']||'';
 reqs.push({path:q.url,model:b.model,authIsTestToken:auth==='Bearer '+TOKEN||xkey===TOKEN,authLooksOAuth:/sk-ant-oat/.test(auth+xkey),authHeaderKind:auth?'authorization':xkey?'x-api-key':'none',stream:!!b.stream});
 if(!q.url.startsWith('/v1/messages')||q.url.includes('count_tokens')){r.writeHead(404);r.end('{}');return;}
 const text='MOCK_'+reqs.length;const msg={id:'msg_'+reqs.length,type:'message',role:'assistant',model:b.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}};
 if(!b.stream){r.writeHead(200,{'content-type':'application/json'});r.end(JSON.stringify({...msg,content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}}));return;}
 r.writeHead(200,{'content-type':'text/event-stream'});const e=(t,d)=>r.write(`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`);
 e('message_start',{message:msg});e('content_block_start',{index:0,content_block:{type:'text',text:''}});e('content_block_delta',{index:0,delta:{type:'text_delta',text}});e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:1}});e('message_stop',{});r.end();});});
await new Promise(x=>srv.listen(0,'127.0.0.1',x));const BASE=`http://127.0.0.1:${srv.address().port}`;
const baseEnv={PATH:process.env.PATH,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:cfg,HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
const run=(label,args,extraEnv={})=>new Promise(res=>{const before=reqs.length;const c=spawn('claude',['-p','--output-format','json',...args],{cwd:proj,env:{...baseEnv,...extraEnv},stdio:['ignore','pipe','pipe']});let so='',se='';c.stdout.on('data',b=>so+=b);c.stderr.on('data',b=>se+=b);const k=setTimeout(()=>c.kill('SIGTERM'),90000);
 c.on('close',(code,sig)=>{clearTimeout(k);let j={};try{j=JSON.parse(so)}catch{}res(out.cases[label]={code,sig,session:j.session_id??null,result:j.result??null,isError:j.is_error??null,requests:reqs.slice(before).filter(x=>x.path.startsWith('/v1/messages')&&!x.path.includes('count')),stderr:se.split('\n').filter(Boolean).slice(-2).map(l=>l.slice(0,200)),stdoutHead:j.session_id?undefined:so.slice(0,300)});});});
const out={root:'<tmp>',cases:{}};
const env1={ANTHROPIC_BASE_URL:BASE,ANTHROPIC_AUTH_TOKEN:TOKEN};
await run('C1a_env_only',['hello'],env1);
await run('C1b_env_ANTHROPIC_MODEL',['hello'],{...env1,ANTHROPIC_MODEL:'model-a'});
writeFileSync(join(root,'launch-settings.json'),JSON.stringify({model:'model-b',env:{ANTHROPIC_BASE_URL:BASE}}));
await run('C1c_settings_file_model_baseurl__token_env',['--settings',join(root,'launch-settings.json'),'hello'],{ANTHROPIC_AUTH_TOKEN:TOKEN});
await run('C1d_flag_model',['--model','model-c','hello'],env1);
// C4 resume
const s=out.cases.C1d_flag_model.session;
await run('C4a_resume_noModel',['--resume',s,'again'],env1);
await run('C4b_resume_modelD',['--resume',s,'--model','model-d','switch'],env1);
await run('C4c_resume_noModel_afterD',['--resume',s,'after'],env1);
out.settingsUnchanged=sha(join(cfg,'settings.json'))===s0;
const files=[];const walk=d=>{for(const f of readdirSync(d,{withFileTypes:true})){const p=join(d,f.name);f.isDirectory()?walk(p):p.endsWith('.jsonl')&&files.push(p)}};walk(join(cfg,'projects'));
out.sessionFiles=files.map(f=>({file:f.replace(root,'<tmp>'),assistantModels:readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l)).filter(x=>x.type==='assistant').map(x=>x.message?.model)}));
out.anyOAuth=reqs.some(r=>r.authLooksOAuth);out.allTestToken=reqs.filter(r=>r.path.startsWith('/v1/messages')).every(r=>r.authIsTestToken);
srv.close();writeFileSync(join(root,'result.json'),JSON.stringify(out,null,1));console.log(JSON.stringify(out,null,1));
