import {query} from '@anthropic-ai/claude-agent-sdk';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {mkdirSync,writeFileSync,appendFileSync,readFileSync,existsSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const root='/private/tmp/willyou-m14-global-f3zh527k';
const dir=join(root,process.argv[2]||'claude-extra-a1');mkdirSync(dir,{recursive:true});
const cwd=join(dir,'project'),home=join(dir,'home'),cfg=join(home,'claude');for(const p of [cwd,home,cfg])mkdirSync(p,{recursive:true});
const events=new EventEmitter(),requests=[],results=[],children=[];
const log=(name,obj)=>appendFileSync(join(dir,name),JSON.stringify(obj)+'\n');
const bounded=(p,ms,label)=>{let t;return Promise.race([p,new Promise((_,reject)=>t=setTimeout(()=>reject(Error('timeout '+label)),ms))]).finally(()=>clearTimeout(t));};
const server=createServer((req,res)=>{let bytes=[];req.on('data',x=>bytes.push(x));req.on('end',()=>{
 if(!req.url.startsWith('/v1/messages')){res.writeHead(404);res.end('{}');return;}
 const body=JSON.parse(Buffer.concat(bytes));requests.push(body);log('requests.jsonl',body);
 const last=JSON.stringify(body.messages?.filter(x=>x.role==='user').at(-1));const tools=body.tools??[];const gotResult=last.includes('tool_result');
 if(last.includes('HOLD_FOR_INTERRUPT')){events.emit('held');return;}
 const desired=last.includes('CALL_MCP')?tools.find(t=>t.name.includes('wy_echo')):last.includes('CALL_SKILL')?tools.find(t=>t.name==='Skill'):last.includes('CALL_WRITE')?tools.find(t=>t.name==='Write'):null;
 const input=desired?.name==='Skill'?{skill:'probe-skill'}:desired?.name==='Write'?{file_path:join(cwd,'must-not-exist.txt'),content:'blocked'}:{};
 const invoke=desired&&!gotResult;
 res.writeHead(200,{'content-type':'text/event-stream'});const e=(type,obj)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...obj})}\n\n`);
 e('message_start',{message:{id:'m'+randomUUID(),type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});
 e('content_block_start',{index:0,content_block:invoke?{type:'tool_use',id:'toolu_'+randomUUID(),name:desired.name,input:{}}:{type:'text',text:''}});
 e('content_block_delta',{index:0,delta:invoke?{type:'input_json_delta',partial_json:JSON.stringify(input)}:{type:'text_delta',text:'OK_SYNTHETIC'}});
 e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:invoke?'tool_use':'end_turn'},usage:{output_tokens:1}});e('message_stop',{});res.end();
});});
await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r);});
const env={HOME:home,PATH:'/usr/bin:/bin',TMPDIR:dir,CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_AUTH_TOKEN:'synthetic-only',ANTHROPIC_MODEL:'claude-sonnet-4-6',ANTHROPIC_DEFAULT_SONNET_MODEL:'claude-sonnet-4-6',ANTHROPIC_DEFAULT_HAIKU_MODEL:'claude-sonnet-4-6',ANTHROPIC_DEFAULT_OPUS_MODEL:'claude-sonnet-4-6',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',ENABLE_TOOL_SEARCH:'false'};
let label='';
async function turn(text,extra={},control){
 let child;const id=randomUUID();const messages=[];let releaseInput;const inputOpen=new Promise(r=>releaseInput=r);
 const prompt=(async function*(){yield {type:'user',uuid:id,session_id:'',parent_tool_use_id:null,message:{role:'user',content:text}};if(control)await inputOpen;})();
 const q=query({prompt,options:{cwd,...(control?{sessionId:randomUUID()}:{}),model:'claude-sonnet-4-6',settingSources:[],env,includePartialMessages:true,stderr:s=>appendFileSync(join(dir,label+'.stderr'),s),...extra,spawnClaudeCodeProcess:o=>{child=spawn(o.command,o.args,{cwd:o.cwd,env:o.env,signal:o.signal,stdio:['pipe','pipe','pipe']});children.push(child);child.stderr.on('data',b=>appendFileSync(join(dir,label+'.native-stderr'),b));log('process.jsonl',{event:'spawn',pid:child.pid,command:o.command,args:o.args});child.once('exit',(code,signal)=>log('process.jsonl',{event:'exit',pid:child.pid,code,signal}));return child;}}});
 const timer=setTimeout(()=>q.close(),30000);
 try{
  const ctl=control?bounded(control(q),15000,label+"-control"):null;const consume=(async()=>{for await(const m of q){messages.push(m);log(label+'.wire.jsonl',m);if(control&&m.type==='result')releaseInput();}})();
  try{await Promise.all([consume,...(ctl?[ctl]:[])]);}catch(e){if(!(control&&messages.some(m=>m.type==='command_lifecycle'&&m.state==='cancelled')&&messages.some(m=>m.type==='result'&&m.subtype==='error_during_execution')))throw e;log('interrupt-terminal.jsonl',{error:String(e),cancelledLifecycle:true});}
  return {id,messages,result:messages.findLast(m=>m.type==='result'),pid:child?.pid};
 }finally{releaseInput();clearTimeout(timer);q.close();if(child&&child.exitCode===null&&child.signalCode===null){const exit=new Promise(r=>child.once('exit',r));child.stdin.end();try{await bounded(exit,3000,'exit');}catch{child.kill('SIGTERM');await bounded(exit,3000,'termination');}}}
}
async function test(id,fn){if(process.argv[3]&&!id.startsWith(process.argv[3]))return;label=id;try{results.push({id,status:'passed',detail:await fn()});}catch(e){results.push({id,status:'failed',error:String(e.stack)});}writeFileSync(join(dir,'result.json'),JSON.stringify(results,null,2));console.log(id,results.at(-1).status);}
let sid;
try{
 await test('X01-user-uuid-and-native-content',async()=>{
  sid=randomUUID();const text='same user text\r\n附件不是原话';const x=await turn(text,{sessionId:sid});assert.equal(x.result?.is_error,false);assert.equal(x.result.user_message_uuid,x.id);
  const paths=[];const walk=p=>{for(const n of readdirSync(p,{withFileTypes:true})){const f=join(p,n.name);if(n.isDirectory())walk(f);else if(n.name===sid+'.jsonl')paths.push(f);}};walk(cfg);assert.equal(paths.length,1);
  const rows=readFileSync(paths[0],'utf8').trim().split('\n').map(JSON.parse);const row=rows.find(x=>x.uuid===x.id);const user=rows.find(r=>r.uuid===x.id&&r.type==='user');assert(user);assert.equal(user.message.content,text);return {uuid:x.id,sid,exactCRLF:true,path:paths[0]};
 });
 await test('X02-resume-same-native-session',async()=>{const before=requests.length;const x=await turn('FOLLOW_UP',{resume:sid});assert.equal(x.result?.session_id,sid);assert.equal(x.result?.is_error,false);assert(requests.slice(before).some(x=>JSON.stringify(x.messages).includes('same user text')));return {sid,historyPresent:true};});
 await test('X03-wrong-root-refuses-native-resume',async()=>{const other=join(home,'other');mkdirSync(other);const before=requests.length;let error;try{const x=await turn('DO_NOT_FALLBACK',{resume:sid,env:{...env,CLAUDE_CONFIG_DIR:other}});if(x.result?.is_error)error=x.result;}catch(e){error=String(e);}assert(error);assert.equal(requests.length,before);return {zeroModelRequests:true,error};});
 await test('X04-filtered-MCP-environment',async()=>{const callfile=join(dir,'mcp-filtered.jsonl');const x=await turn('CALL_MCP',{mcpServers:{wy:{command:'/usr/bin/env',args:['-i','HOME='+home,'PATH=/usr/bin:/bin','WY_STATIC=filtered','/opt/homebrew/bin/node',join(root,'mcp.mjs'),callfile]}},allowedTools:['mcp__wy__wy_echo']});assert.equal(x.result?.is_error,false);const calls=readFileSync(callfile,'utf8').trim().split('\n').map(JSON.parse);assert(calls.length>0);assert(calls.every(x=>!x.hasAnthropicKey&&!x.hasModelKey));return calls;});
 await test('X05-SDK-native-tool-denial',async()=>{const seen=[];const x=await turn('CALL_WRITE',{canUseTool:async(name,input)=>{seen.push({name,input});return {behavior:'deny',message:'probe denies write'};}});assert(seen.some(s=>s.name==='Write'));assert(!existsSync(join(cwd,'must-not-exist.txt')));return {requested:seen.map(x=>x.name),fileAbsent:true,result:x.result?.subtype};});
 await test('X06-native-interrupt-terminal-event',async()=>{const held=new Promise(r=>events.once('held',r));const x=await turn('HOLD_FOR_INTERRUPT',{},async(q)=>{await held;await q.interrupt();});assert(x.result);assert(x.messages.some(m=>m.type==='result'));return {subtype:x.result.subtype,is_error:x.result.is_error,stop_reason:x.result.stop_reason};});
 await test('X07-project-settings-isolation-and-instructions',async()=>{
  mkdirSync(join(cwd,'.claude'),{recursive:true});writeFileSync(join(cwd,'.claude/settings.json'),JSON.stringify({env:{ANTHROPIC_BASE_URL:'http://127.0.0.1:1',ANTHROPIC_AUTH_TOKEN:'forbidden-project'}}));writeFileSync(join(cwd,'CLAUDE.md'),'PROJECT_INSTRUCTIONS_SENTINEL_716\n');
  const before=requests.length;const x=await turn('CHECK_PROJECT',{settingSources:['user'],systemPrompt:{type:'preset',preset:'claude_code'},additionalDirectories:[cwd],env:{...env,CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD:'1'}});assert.equal(x.result?.is_error,false);assert(requests.slice(before).some(x=>JSON.stringify(x).includes('PROJECT_INSTRUCTIONS_SENTINEL_716')));return {projectSettingsIgnored:true,instructionsSeenByEndpoint:true};
 });
 await test('X08-local-plugin-skill-discovery-and-call',async()=>{
  const plugin=join(dir,'plugin');mkdirSync(join(plugin,'.claude-plugin'),{recursive:true});mkdirSync(join(plugin,'skills/probe-skill'),{recursive:true});writeFileSync(join(plugin,'.claude-plugin/plugin.json'),JSON.stringify({name:'probe',version:'1.0.0'}));writeFileSync(join(plugin,'skills/probe-skill/SKILL.md'),'---\nname: probe-skill\ndescription: M14 compatibility sentinel skill\n---\nSKILL_BODY_SENTINEL_716\n');
  const before=requests.length;const x=await turn('CALL_SKILL',{plugins:[{type:'local',path:plugin}],allowedTools:['Skill']});assert.equal(x.result?.is_error,false);assert(x.messages.some(x=>x.subtype==='init'&&JSON.stringify(x).includes('probe-skill')));assert(requests.slice(before).some(x=>JSON.stringify(x).includes('SKILL_BODY_SENTINEL_716')));return {plugin,bodyReachedEndpoint:true,relativeScriptExecution:'not tested'};
 });
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));writeFileSync(join(dir,'cleanup.json'),JSON.stringify(children.map(x=>({pid:x.pid,exitCode:x.exitCode,signalCode:x.signalCode})),null,2));}
