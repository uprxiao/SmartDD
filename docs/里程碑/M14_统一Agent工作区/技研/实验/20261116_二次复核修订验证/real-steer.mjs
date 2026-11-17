// Real Codex turn/steer and Claude streaming input during a held MCP tool.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdirSync,existsSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openCodex,CLAUDE_BIN,versions,redact} from '../../复核_20261116/probes/lib/agents.mjs';
const out=resolve(process.argv[2]);assert(!existsSync(out));mkdirSync(out,{recursive:true});
const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let seq=0,current;const results=[];
const log=(event,data={})=>{const row={seq:++seq,t:Date.now(),event,...data};appendFileSync(join(out,'host.jsonl'),redact(row)+'\n');return row;};
const server=createServer(async(req,res)=>{
 if(!current||req.headers.authorization!=='Bearer '+current.ticket){res.writeHead(403);res.end();return;}
 log('native-tool-held',{driver:current.driver});current.held.resolve();await current.release.promise;res.end('GATE_RELEASED');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
writeFileSync(join(out,'versions.json'),JSON.stringify(versions(),null,2));
try{
 for(const driver of ['codex','claude']){
  const c={driver,ticket:randomUUID(),held:defer(),release:defer()},cwd=join(out,driver);mkdirSync(cwd);current=c;
  const mcp={command:process.execPath,args:[join(import.meta.dirname,'steer-mcp.mjs'),`http://127.0.0.1:${server.address().port}/gate`,c.ticket],env:{ANTHROPIC_AUTH_TOKEN:'',ANTHROPIC_API_KEY:'',DEEPSEEK_API_KEY:''}};
  const first='Call the wait_gate MCP tool exactly once. After it returns, reply BASELINE. Do not use other tools.';
  let cp;
  try{
   const marker='STEER_'+randomUUID().replaceAll('-',''),text='New instruction while the tool is running: after wait_gate returns, reply exactly '+marker+' instead of BASELINE. Do not call any more tools.';
   if(driver==='codex'){
    const client=await openCodex({cwd,out,actor:driver,mcp:{name:'gate',...mcp}});cp=client.child;
    try{
     await client.start();const turn=await client.rpc('turn/start',{threadId:client.threadId,input:[{type:'text',text:first,text_elements:[]}]});
     await c.held.promise;assert(!client.events.some(e=>e.method==='turn/completed'));
     const submitted=log('mid-turn-input-submitted',{driver,turnId:turn.turn.id,marker});
     const ack=await client.rpc('turn/steer',{threadId:client.threadId,expectedTurnId:turn.turn.id,input:[{type:'text',text,text_elements:[]}]});
     log('steer-accepted',{driver,ack});c.release.resolve();
     const done=await client.next(e=>e.method==='turn/completed'&&e.params.turn.id===turn.turn.id,120000);
     assert.equal(done.params.turn.status,'completed');
     const final=client.events.filter(e=>e.method==='item/completed'&&e.params.item.type==='agentMessage').map(e=>e.params.item.text).join('\n');assert(final.includes(marker));
     results.push({driver,status:'passed',protocol:'turn/steer',submittedWhileNativeToolPending:true,accepted:ack,turnId:turn.turn.id,sameTurnCompleted:true,marker,final,submittedSeq:submitted.seq});
    }finally{c.release.resolve();await client.close();}
   }else{
    const {query}=await import(process.env.M14_CLAUDE_SDK),input=defer(),consumed=defer(),uid=randomUUID(),messages=[];
    const key=process.env.DEEPSEEK_API_KEY;assert(key,'DEEPSEEK_API_KEY missing');
    const home=join(cwd,'home');mkdirSync(join(home,'.claude'),{recursive:true});
    const prompt=(async function*(){yield {type:'user',uuid:randomUUID(),session_id:'',parent_tool_use_id:null,message:{role:'user',content:first}};await input.promise;yield {type:'user',uuid:uid,session_id:'',parent_tool_use_id:null,message:{role:'user',content:text}};consumed.resolve();})();
    const q=query({prompt,options:{pathToClaudeCodeExecutable:CLAUDE_BIN,cwd,settingSources:[],model:'deepseek-flash',maxTurns:8,tools:[],permissionMode:'dontAsk',allowedTools:['mcp__gate__wait_gate'],mcpServers:{gate:mcp},env:{HOME:home,CLAUDE_CONFIG_DIR:join(home,'.claude'),PATH:process.env.PATH,TMPDIR:cwd,ENABLE_TOOL_SEARCH:'false',ANTHROPIC_BASE_URL:'https://api.deepseek.com/anthropic',ANTHROPIC_AUTH_TOKEN:key,ANTHROPIC_API_KEY:'',ANTHROPIC_MODEL:'deepseek-flash',DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},spawnClaudeCodeProcess:o=>cp=spawn(o.command,o.args,{cwd:o.cwd,env:o.env,signal:o.signal,stdio:['pipe','pipe','pipe']})}});
    const reading=(async()=>{for await(const m of q){messages.push(m);appendFileSync(join(out,'native.jsonl'),redact({actor:driver,driver,t:Date.now(),...m})+'\n');if(m.type==='result')log('native-result',{driver,inputId:m.user_message_uuid,subtype:m.subtype,text:m.result});}})();
    try{
     await c.held.promise;assert(!messages.some(m=>m.type==='result'));
     const submitted=log('mid-turn-input-submitted',{driver,inputId:uid,marker});input.resolve();await consumed.promise;log('sdk-input-stream-consumed',{driver,inputId:uid});c.release.resolve();await reading;
     const terminal=messages.filter(m=>m.type==='result');assert(terminal.length);assert(terminal.every(m=>!m.is_error));
     const final=terminal.map(m=>m.result??'').join('\n');assert(final.includes(marker));
     results.push({driver,status:'passed',protocol:'SDK AsyncIterable input',submittedWhileNativeToolPending:true,inputId:uid,marker,final,results:terminal.map(m=>({inputId:m.user_message_uuid,subtype:m.subtype,text:m.result})),submittedSeq:submitted.seq});
    }finally{input.resolve();c.release.resolve();q.close();await reading.catch(()=>{});}
   }
  }catch(e){results.push({driver,status:'failed',error:String(e.stack??e)});}
  finally{
   c.release.resolve();if(cp&&cp.exitCode===null&&cp.signalCode===null)await new Promise(r=>{const timer=setTimeout(()=>{cp.kill('SIGTERM');},10000);cp.once('exit',()=>{clearTimeout(timer);r();});});
   log('owner-exited',{driver,code:cp?.exitCode,signal:cp?.signalCode});writeFileSync(join(out,'result.json'),redact({scope:'real model + held synthetic MCP gate; no production App',results}));
  }
  console.log(driver,results.at(-1).status);
 }
}finally{current?.release.resolve();server.closeAllConnections();await new Promise(r=>server.close(r));writeFileSync(join(out,'cleanup.json'),JSON.stringify({httpClosed:!server.listening}));}
process.exitCode=results.every(r=>r.status==='passed')?0:1;
