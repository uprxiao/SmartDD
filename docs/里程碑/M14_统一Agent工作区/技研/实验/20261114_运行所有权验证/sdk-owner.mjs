import {query} from '/private/tmp/willyou-m14-global-f3zh527k/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{runFixture,MacProcessIdentityReader}=require('./actual.cjs');
const dir=process.argv[2];mkdirSync(dir,{recursive:true});
let f,child,q,exitTracked,attached,server;const trace=[];let requestCount=0,result,error;
const mark=(event,detail={})=>trace.push({event,...detail});
const bounded=(p,ms)=>{let t;return Promise.race([p,new Promise((_,rej)=>t=setTimeout(()=>rej(Error('probe timeout')),ms))]).finally(()=>clearTimeout(t));};
try{
 const reader=new MacProcessIdentityReader(new URL('./process-identity',import.meta.url).pathname);f=await runFixture(reader);
 const h=await f.create();await h.prepare();await h.cli.arm();mark('armed');
 server=createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{try{
  assert(req.url.startsWith('/v1/messages'));const body=JSON.parse(Buffer.concat(chunks));requestCount++;assert.equal(f.runs.assertActive(h.runId).run.pid,child.pid);mark('model-request-with-active-owner',{model:body.model});
  res.writeHead(200,{'content-type':'text/event-stream'});const e=(type,obj)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...obj})}\n\n`);
  e('message_start',{message:{id:'m'+randomUUID(),type:'message',role:'assistant',model:body.model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}});e('content_block_start',{index:0,content_block:{type:'text',text:''}});e('content_block_delta',{index:0,delta:{type:'text_delta',text:'OWNED_OK'}});e('content_block_stop',{index:0});e('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:1}});e('message_stop',{});res.end();
 }catch(e){error=e;res.writeHead(500);res.end('{}');}});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const cfg=f.snapshot.native.stateRoot;mkdirSync(cfg);mark('snapshot-runtime-root-aligned',{stateRoot:cfg,cwd:f.snapshot.native.cwd});let ready,failed;const readyPromise=new Promise((r,j)=>{ready=r;failed=j;});readyPromise.catch(()=>{});
 f.setRevoke(()=>{q?.close();mark('authority-revoked');});
 const prompt=(async function*(){await readyPromise;assert(!h.signal.aborted);assert.equal(f.runs.assertActive(h.runId).run.runId,h.runId);mark('input-released-after-attach');yield {type:'user',uuid:randomUUID(),session_id:'',parent_tool_use_id:null,message:{role:'user',content:'Return OWNED_OK'}};})();
 q=query({prompt,options:{cwd:f.snapshot.native.cwd,model:'claude-sonnet-4-6',settingSources:[],env:{HOME:f.home,PATH:'/usr/bin:/bin',TMPDIR:f.root,CLAUDE_CONFIG_DIR:cfg,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_AUTH_TOKEN:'synthetic-only',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1',ENABLE_TOOL_SEARCH:'false'},spawnClaudeCodeProcess:o=>{
   assert(!h.signal.aborted);assert.equal(child,undefined,'no implicit respawn');child=spawn(o.command,o.args,{cwd:o.cwd,env:o.env,signal:o.signal,stdio:['pipe','pipe','pipe']});mark('spawn',{pid:child.pid});child.stderr.resume();
   exitTracked=new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>{mark('exit',{pid:child.pid,code,signal});h.cli.exited().then(resolve,reject);});child.once('error',e=>{failed(e);reject(e);});});exitTracked.catch(()=>{});
   const identity=reader.read(child.pid);assert(identity);mark('kernel-birth-read',{pid:identity.pid,startedAt:identity.startedAt});attached=h.cli.attach(child.pid,identity.startedAt).then(()=>{mark('attached');ready();},e=>{failed(e);throw e;});attached.catch(()=>{});return child;
 }}});
 await bounded((async()=>{for await(const message of q){if(message.type==='result'){result={type:message.type,subtype:message.subtype,text:message.result};mark('result',result);}}})(),30000);
 q.close();await bounded(exitTracked,5000);await attached;if(error)throw error;assert.equal(result.subtype,'success');assert.equal(result.text,'OWNED_OK');assert.equal(requestCount,1);assert.equal(f.runs.get(h.runId).state,'stopped');assert.throws(()=>f.runs.assertActive(h.runId));assert.deepEqual(f.sqlite.prepare("SELECT state FROM capability_resource_leases WHERE owner_id=?").all(h.runId).map(x=>x.state),['released']);mark('stopped-and-lease-released');
}catch(e){error=e;}
finally{q?.close();if(child&&child.exitCode===null&&child.signalCode===null){const end=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await bounded(end,5000);}try{await exitTracked;}catch(e){error??=e;}if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}f?.cleanup();}
writeFileSync(dir+'/result.json',JSON.stringify({id:'O13-sdk-native-spawn-owned-run',status:error?'failed':'passed',error:error?.stack,scope:'Actual Claude SDK 0.3.321 / native 2.1.321 and current WillYou run/resource/session registry; synthetic fixture, loopback fake model, no private MCP bridge or full launcher; current registry still mints ptyId as its internal launch identity',sourceSha256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),requestCount,trace},null,2));console.log(error?error.stack:'O13 passed');process.exitCode=error?1:0;
