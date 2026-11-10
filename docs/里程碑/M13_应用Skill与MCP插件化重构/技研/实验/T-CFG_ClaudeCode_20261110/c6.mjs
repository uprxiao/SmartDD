import http from 'node:http';import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';import {join} from 'node:path';
const ALLOW=/^(deepseek|ultrapwor)\//;
const root=mkdtempSync('/tmp/m13-cc6-'),cfg=join(root,'cfg'),proj=join(root,'proj');mkdirSync(cfg);mkdirSync(proj);
for(const f of ['a.txt','b.md','c.json'])writeFileSync(join(proj,f),'x\n');
const log=[];
const guard=http.createServer((q,r)=>{const c=[];q.on('data',b=>c.push(b));q.on('end',()=>{const raw=Buffer.concat(c);let model=null;try{model=JSON.parse(raw).model}catch{}
  const isMsg=q.url.startsWith('/v1/messages');const allowed=!isMsg||(model&&ALLOW.test(model));
  log.push({path:q.url.split('?')[0],method:q.method,model,allowed,authIsMagpieToken:(q.headers.authorization==='Bearer magpie-claude'||q.headers['x-api-key']==='magpie-claude')});
  if(!allowed){r.writeHead(400,{'content-type':'application/json'});r.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'WillYou test guard blocked model '+model}}));return;}
  const h={...q.headers,host:'127.0.0.1:3425'};delete h['content-length'];
  const p=http.request({host:'127.0.0.1',port:3425,path:q.url,method:q.method,headers:{...h,'content-length':raw.length}},pr=>{r.writeHead(pr.statusCode,pr.headers);pr.pipe(r);});p.on('error',e=>{r.writeHead(502);r.end(String(e))});p.end(raw);});});
await new Promise(x=>guard.listen(0,'127.0.0.1',x));const BASE=`http://127.0.0.1:${guard.address().port}`;
const M='deepseek/deepseek-flash';
const env={PATH:process.env.PATH,HOME:process.env.HOME,CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:BASE,ANTHROPIC_AUTH_TOKEN:'magpie-claude',
 ANTHROPIC_DEFAULT_OPUS_MODEL:M,ANTHROPIC_DEFAULT_SONNET_MODEL:M,ANTHROPIC_DEFAULT_HAIKU_MODEL:M,ANTHROPIC_DEFAULT_FABLE_MODEL:M,ANTHROPIC_SMALL_FAST_MODEL:M,CLAUDE_CODE_SUBAGENT_MODEL:M,
 HTTPS_PROXY:'http://127.0.0.1:1',HTTP_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'};
const TASK='用 Bash 执行 ls 列出当前目录，然后只回复一行：FILES=<文件数量>。必须实际执行命令。';
const out={tool:{},session:[]};
const run=(args)=>new Promise(res=>{const before=log.length,t0=Date.now();const c=spawn('claude',['-p','--output-format','stream-json','--verbose','--allowedTools','Bash(ls:*)','Bash(ls)',...args],{cwd:proj,env,stdio:['ignore','pipe','pipe']});let so='',se='';c.stdout.on('data',b=>so+=b);c.stderr.on('data',b=>se+=b);const k=setTimeout(()=>c.kill('SIGTERM'),180000);
 c.on('close',(code,sig)=>{clearTimeout(k);const ev=so.split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
  const tools=ev.filter(e=>e.type==='assistant').flatMap(e=>e.message.content.filter(x=>x.type==='tool_use').map(x=>(x.input?.command||'').slice(0,60)));
  const toolRes=ev.filter(e=>e.type==='user').flatMap(e=>(e.message.content||[]).filter(x=>x.type==='tool_result').map(x=>({isError:!!x.is_error})));
  const fin=ev.find(e=>e.type==='result');
  res({code,sig,sec:Math.round((Date.now()-t0)/1000),session:fin?.session_id??ev.find(e=>e.session_id)?.session_id,tools,toolRes,result:String(fin?.result??'').slice(0,120),isError:fin?.is_error??null,requests:log.slice(before),stderr:se.split('\n').filter(Boolean).slice(-2).map(l=>l.slice(0,200))});});});
for(const m of ['deepseek/deepseek-flash','deepseek/deepseek-v4-pro','ultrapwor/deepseek-v4-pro-0813','ultrapwor/glm-5.3-flash','ultrapwor/kimi-k2.5','ultrapwor/glm-5']){out.tool[m]=await run(['--model',m,TASK]);process.stderr.write(m+' '+out.tool[m].code+' '+out.tool[m].result+'\n');}
const s1=await run(['--model','deepseek/deepseek-flash','记住暗号 BLUE-42，只回复 OK']);out.session.push({model:'deepseek/deepseek-flash',...s1});
out.session.push({model:'ultrapwor/kimi-k2.5',...await run(['--resume',s1.session,'--model','ultrapwor/kimi-k2.5','把暗号末尾数字加1，记为新暗号，只回复新暗号'])});
out.session.push({model:'ultrapwor/glm-5.3-flash',...await run(['--resume',s1.session,'--model','ultrapwor/glm-5.3-flash','用 Bash 执行 ls 统计文件数，然后只回复：<最新暗号> FILES=<数量>'])});
out.session.push({model:'(resume 不指定)',...await run(['--resume',s1.session,'最新暗号是什么？只回复暗号'])});
out.blocked=log.filter(x=>!x.allowed);out.allMagpieToken=log.filter(x=>x.path.startsWith('/v1/messages')).every(x=>x.authIsMagpieToken);
out.modelsSeen=[...new Set(log.map(x=>x.model).filter(Boolean))];
guard.close();writeFileSync(join(root,'result.json'),JSON.stringify(out,null,1));console.log(JSON.stringify(out));
