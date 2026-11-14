import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdirSync,writeFileSync,readFileSync,appendFileSync,existsSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import assert from 'node:assert/strict';
const root=dirname(fileURLToPath(import.meta.url));
const batch=process.argv[2]||'native-a1';
const managed=process.argv.includes('--managed');
const dir=join(root,batch);mkdirSync(dir,{recursive:true});
const home=join(dir,'home'),cwd=join(dir,'project'),config=join(home,'claude'),ch=join(home,'codex');
for(const p of [home,cwd,config,ch])mkdirSync(p,{recursive:true});
const log=(file,value)=>appendFileSync(join(dir,file),JSON.stringify(value)+'\n');
const results=[];const owned=[];
const envBase={HOME:home,PATH:managed?'/usr/bin:/bin':'/opt/homebrew/bin:/usr/bin:/bin',TMPDIR:dir,LANG:'en_US.UTF-8',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',ENABLE_TOOL_SEARCH:'false'};
const calls=[];
const server=createServer((req,res)=>{let chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{
 let b;try{b=JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{res.writeHead(400);res.end();return;}
 if(!req.url.includes('messages')&&!req.url.includes('responses')){res.writeHead(404);res.end('{}');return;}
 calls.push({url:req.url,body:b});log('model-requests.jsonl',{url:req.url,auth:req.headers.authorization??req.headers['x-api-key']??null,body:b});
 const anthropic=req.url.includes('messages');
 const userItems=anthropic?b.messages?.filter(x=>x.role==='user')??[]:b.input?.filter(x=>x.role==='user')??[];
 const lastUser=JSON.stringify(userItems.at(-1));
 const wantTool=lastUser.includes('CALL_MCP');
 const tools=(b.tools??[]).flatMap(t=>t.type==='namespace'?(t.tools??[]).map(x=>({...x,namespace:t.name})):[t]);
 const tool=tools.find(t=>((t.namespace??'')+(t.name??'')).includes('wy_echo'));
 const hasResult=anthropic?JSON.stringify(b.messages?.at(-1)).includes('tool_result'):(b.input??[]).some(x=>x.type==='function_call_output');
 const invoke=wantTool&&tool&&!hasResult;
 const answer='MOCK_OK '+(lastUser.includes('BETA')?'BETA':'ALPHA');
 res.writeHead(200,{'content-type':'text/event-stream'});
 const event=(type,data)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
 if(anthropic){
  event('message_start',{message:{id:'msg_'+randomUUID(),type:'message',role:'assistant',model:b.model,content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}});
  event('content_block_start',{index:0,content_block:invoke?{type:'tool_use',id:'toolu_'+randomUUID(),name:tool.name,input:{}}:{type:'text',text:''}});
  event('content_block_delta',{index:0,delta:invoke?{type:'input_json_delta',partial_json:'{}'}:{type:'text_delta',text:answer}});
  event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:invoke?'tool_use':'end_turn'},usage:{output_tokens:5}});event('message_stop',{});
 }else{
  const rid='resp_'+randomUUID();
  const item=invoke?{id:'fc_'+randomUUID(),type:'function_call',status:'completed',call_id:'call_'+randomUUID(),name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),arguments:'{}'}:{id:'msg_'+randomUUID(),type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
  event('response.created',{response:{id:rid,status:'in_progress',output:[]}});
  event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress'}});
  if(!invoke)event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:answer});
  event('response.output_item.done',{output_index:0,item});
  event('response.completed',{response:{id:rid,status:'completed',output:[item],usage:{input_tokens:10,output_tokens:5,total_tokens:15}}});
 }
 res.end();
});});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
const url=`http://127.0.0.1:${server.address().port}`;
const mcp=join(root,'mcp.mjs');
const deadline=(promise,ms,label)=>{let t;return Promise.race([promise,new Promise((_,rej)=>{t=setTimeout(()=>rej(Error('timeout '+label)),ms);})]).finally(()=>clearTimeout(t));};
async function test(id,fn){try{const detail=await deadline(fn(),45000,id);results.push({id,status:'passed',detail});}catch(e){results.push({id,status:'failed',error:String(e.stack??e)});}writeFileSync(join(dir,'result.json'),JSON.stringify(results,null,2));console.log(id,results.at(-1).status);}
function trackedSpawn(command,args,options){const child=spawn(command,args,options);owned.push(child);log('process.jsonl',{event:'spawn',pid:child.pid,command,args});child.once('exit',(code,signal)=>log('process.jsonl',{event:'exit',pid:child.pid,code,signal}));return child;}
async function stop(child){if(child.exitCode!==null||child.signalCode!==null)return;const exit=new Promise(r=>child.once('exit',r));child.stdin?.end();try{await deadline(exit,5000,'exit');}catch{child.kill('SIGTERM');await deadline(exit,5000,'terminate');}}
let codex;
try{
 await test('N01-codex-initialize-native-nongit',async()=>{
  const args=['app-server','--disable','plugins','-c','analytics.enabled=false','-c','model_provider="m14"','-c',`model_providers.m14={name="m14",base_url="${url}/v1",wire_api="responses",env_key="WY_MOCK_KEY"}`,'-c',`mcp_servers.wy={command="/opt/homebrew/bin/node",args=["${mcp}","${join(dir,'mcp-calls.jsonl')}"],env={WY_STATIC="codex-only"},default_tools_approval_mode="approve"}`];
  const child=trackedSpawn(managed?'/opt/homebrew/bin/node':'/opt/homebrew/bin/codex',managed?[join(root,'node_modules/@openai/codex/bin/codex.js'),...args]:args,{cwd,env:{...envBase,CODEX_HOME:ch,WY_MOCK_KEY:'synthetic-codex-key'},stdio:['pipe','pipe','pipe']});
  child.stderr.on('data',b=>appendFileSync(join(dir,'codex.stderr'),b));
  const pending=new Map(),events=[],waiters=[];let serial=0;
  const rl=createInterface({input:child.stdout});
  rl.on('line',line=>{let x;try{x=JSON.parse(line);}catch{return log('invalid.jsonl',{line});}log('codex-wire.jsonl',x);if(x.id!==undefined&&!x.method){const p=pending.get(x.id);if(p){pending.delete(x.id);x.error?p.reject(Error(JSON.stringify(x.error))):p.resolve(x.result);}}else{events.push(x);if(x.method&&x.id!==undefined)child.stdin.write(JSON.stringify({id:x.id,error:{code:-32601,message:'probe does not approve this request'}})+'\n');for(const w of [...waiters])if(w.match(x)){waiters.splice(waiters.indexOf(w),1);w.resolve(x);}}});
  const rpc=(method,params)=>deadline(new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});log('codex-sent.jsonl',{id,method,params});child.stdin.write(JSON.stringify({id,method,params})+'\n');}),15000,method);
  const next=(match)=>{const x=events.find(match);return x?Promise.resolve(x):new Promise(resolve=>waiters.push({match,resolve}));};
  codex={child,rpc,next};
  const init=await rpc('initialize',{clientInfo:{name:'m14_probe',version:'0.0.1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const t=await rpc('thread/start',{model:'mock-model',modelProvider:'m14',cwd,approvalPolicy:'never',sandbox:'read-only',experimentalRawEvents:true});codex.tid=t.thread.id;assert(!existsSync(join(cwd,'.git')));return {init,thread:t.thread.id};
 });
 if(codex?.tid){
  await test('N02-codex-two-turns-mcp-input-id',async()=>{const turns=[];for(const text of ['ALPHA CALL_MCP','BETA remember ALPHA']){const userId=randomUUID();const r=await codex.rpc('turn/start',{threadId:codex.tid,input:[{type:'text',text,text_elements:[]}],clientUserMessageId:userId});const e=await codex.next(x=>x.method==='turn/completed'&&x.params?.turn?.id===r.turn.id);assert.equal(e.params.turn.status,'completed');turns.push({id:r.turn.id,userId,status:e.params.turn.status});}const logs=readFileSync(join(dir,'mcp-calls.jsonl'),'utf8');assert(logs.includes('codex-only'));assert(calls.some(x=>JSON.stringify(x.body.input).includes('ALPHA')&&JSON.stringify(x.body.input).includes('BETA')));return turns;});
  await test('N03-codex-inject-and-history',async()=>{const r=await codex.rpc('thread/inject_items',{threadId:codex.tid,items:[{type:'message',role:'developer',content:[{type:'input_text',text:'HANDOFF_MARKER_123 no user authority'}]}]});const t=await codex.rpc('turn/start',{threadId:codex.tid,input:[{type:'text',text:'GAMMA',text_elements:[]}]});await codex.next(x=>x.method==='turn/completed'&&x.params?.turn?.id===t.turn.id);assert(calls.some(x=>JSON.stringify(x.body).includes('HANDOFF_MARKER_123')));const history=await codex.rpc('thread/read',{threadId:codex.tid,includeTurns:true});writeFileSync(join(dir,'codex-history.json'),JSON.stringify(history,null,2));return {injected:r,turns:history.thread?.turns?.length};});
  await stop(codex.child);
 }
 await test('N04-claude-sdk-stream-two-turns-mcp',async()=>{
  const {query}=await import('@anthropic-ai/claude-agent-sdk');
  let waiting;const queue=[];let done=false;
  const input={ [Symbol.asyncIterator](){return this;}, next(){if(queue.length)return Promise.resolve({value:queue.shift(),done:false});if(done)return Promise.resolve({done:true});return new Promise(r=>waiting=r);},return(){done=true;waiting?.({done:true});return Promise.resolve({done:true});}};
  const push=text=>{const value={type:'user',message:{role:'user',content:text},parent_tool_use_id:null,session_id:'',uuid:randomUUID()};log('claude-sent.jsonl',value);if(waiting){const r=waiting;waiting=null;r({value,done:false});}else queue.push(value);};
  const sid=randomUUID();let spawned,resultsCount=0;const messages=[];
  const q=query({prompt:input,options:{...(managed?{}:{pathToClaudeCodeExecutable:'/Users/hx/.local/bin/claude'}),cwd,sessionId:sid,model:'mock-model',settingSources:[],env:{...envBase,CLAUDE_CONFIG_DIR:config,ANTHROPIC_BASE_URL:url,ANTHROPIC_AUTH_TOKEN:'synthetic-claude-key'},mcpServers:{wy:{command:'/opt/homebrew/bin/node',args:[mcp,join(dir,'mcp-calls.jsonl')],env:{WY_STATIC:'claude-only'}}},allowedTools:['mcp__wy__wy_echo'],includePartialMessages:true,permissionMode:'default',stderr:s=>appendFileSync(join(dir,'claude.stderr'),s),spawnClaudeCodeProcess:o=>{spawned=trackedSpawn(o.command,o.args,{cwd:o.cwd,env:o.env,signal:o.signal,stdio:['pipe','pipe','pipe']});return spawned;}}});
  try{push('ALPHA CALL_MCP');for await(const m of q){messages.push(m);log('claude-wire.jsonl',m);if(m.type==='result'){resultsCount++;if(resultsCount===1)push('BETA remember ALPHA');else break;}}
  assert.equal(resultsCount,2);assert(messages.some(x=>x.type==='system'&&x.subtype==='init'&&x.session_id===sid));assert(readFileSync(join(dir,'mcp-calls.jsonl'),'utf8').includes('claude-only'));return {sid,pid:spawned?.pid,results:resultsCount,types:[...new Set(messages.map(x=>x.type))]};}
  finally{done=true;waiting?.({done:true});q.close();if(spawned)await stop(spawned);}
 });
}finally{
 for(const p of owned)await stop(p).catch(e=>log('cleanup-errors.jsonl',{pid:p.pid,error:String(e)}));
 server.closeAllConnections();await new Promise(r=>server.close(r));
 writeFileSync(join(dir,'cleanup.json'),JSON.stringify(owned.map(x=>({pid:x.pid,exitCode:x.exitCode,signalCode:x.signalCode})),null,2));
 writeFileSync(join(dir,'result.json'),JSON.stringify(results,null,2));
}
