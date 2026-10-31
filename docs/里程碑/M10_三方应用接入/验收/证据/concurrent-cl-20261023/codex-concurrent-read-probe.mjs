// Actual pinned CLI, isolated native state, synthetic loopback Responses only.
// Does not prove real model reasoning, packaged UI, or external business execution.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Client} from '../../docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/codex/probe.mjs';
const cli=process.env.WILLYOU_CODEX_CLI;assert(cli);
assert.equal(execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),'codex-cli 0.162.1');
const root=await mkdtemp('/private/tmp/willyou-m10-concurrent-read-'),home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project');
const result={root,startedAt:new Date().toISOString(),layer:'real CLI with synthetic provider;not real model or packaged App',cliVersion:'0.162.1',requests:[],checks:[],status:'running'};
for(const p of [home,state,join(cwd,'.git')])await mkdir(p,{recursive:true});
const paths={},markers={};for(const v of ['v1','v2']){const p=join(home,'.agents/skills','read-'+v,'SKILL.md');await mkdir(dirname(p),{recursive:true});markers[v]='M10_BODY_ONLY_'+v+'_'+root.split('-').at(-1);await writeFile(p,'---\nname: read-'+v+'\ndescription: Isolated read fixture.\n---\n\n'+markers[v]+'\nNo tools or external actions are requested.\n');paths[v]=p;}
const evidenceWrites=[];result.sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();result.platform=process.platform;result.arch=process.arch;result.cliEntrySha256=createHash('sha256').update(await readFile(cli)).digest('hex');result.skills=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([v,p])=>[v,{path:p,bodyMarker:markers[v],sha256:createHash('sha256').update(await readFile(p)).digest('hex')}])));
const fixture=resolve('scripts/applications/fixtures/codex-marker-mcp.mjs');
const packages={};
for(const v of ['v1','v2']){
 const manifest={kind:'controlled-probe-package-not-production-app-manifest',version:v,skillSha256:result.skills[v].sha256,toolSourceSha256:createHash('sha256').update(await readFile(fixture)).digest('hex'),marker:'M10_FIXED_TOOL_'+v};
 const bytes=JSON.stringify(manifest),path=join(root,'fixture-package-'+v+'.json');await writeFile(path,bytes);
 packages[v]={...manifest,packageHash:createHash('sha256').update(bytes).digest('hex'),manifestPath:path};
}
result.toolPackages=packages;assert.notEqual(packages.v1.packageHash,packages.v2.packageHash);
const native=resolve(dirname(cli),'../@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex');
result.nativeBinary={path:native,sha256:createHash('sha256').update(await readFile(native)).digest('hex')};
const sockets=new Set();const server=createServer((req,res)=>{let chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end();return;}const raw=Buffer.concat(chunks).toString();let body;try{body=JSON.parse(raw);}catch{res.writeHead(400);res.end();return;}const n=result.requests.length+1;evidenceWrites.push(writeFile(join(root,'request-'+n+'.json'),raw+'\n'));result.requests.push({number:n,sha256:createHash('sha256').update(raw).digest('hex'),v1Body:raw.includes(markers.v1),v2Body:raw.includes(markers.v2),model:body.model});const text='M10_SYNTHETIC_RESPONSE_'+n,id='msg_'+n,item={id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};res.writeHead(200,{'content-type':'text/event-stream','connection':'close'});const send=(type,data)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n');send('response.created',{response:{id:'resp_'+n,status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});send('response.content_part.added',{item_id:id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send('response.output_text.delta',{item_id:id,output_index:0,content_index:0,delta:text});send('response.output_text.done',{item_id:id,output_index:0,content_index:0,text});send('response.content_part.done',{item_id:id,output_index:0,content_index:0,part:item.content[0]});send('response.output_item.done',{output_index:0,item});send('response.completed',{response:{id:'resp_'+n,status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();});});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const clients=[];async function launch(label,version){const args=['--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','--disable','hooks','-c','web_search="disabled"','-c','model="m10-synthetic"','-c','model_provider="m10"','-c',`model_providers.m10={name="M10 private fixture",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",requires_openai_auth=false}`,'-c',`skills.config=[{path=${JSON.stringify(paths.v1)},enabled=${version==='v1'}},{path=${JSON.stringify(paths.v2)},enabled=${version==='v2'}}]`,'-c',`mcp_servers.m10_marker={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(fixture)},${JSON.stringify(packages[version].manifestPath)}]}`,'-c','analytics.enabled=false','-c','feedback.enabled=false','app-server','--stdio'];result.launches??=[];result.launches.push({label,version,args,cwd});const c=new Client(label,args,cwd,{PATH:dirname(cli)+':'+process.env.PATH,HOME:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'});clients.push(c);await c.rpc('initialize',{clientInfo:{name:'m10_skill_read',version:'1.0.0'},capabilities:{experimentalApi:true}});c.child.stdin.write(JSON.stringify({method:'initialized'})+'\n');return c;}
async function turn(c,id,version){let done;const completion=new Promise(r=>done=r),before=result.requests.length;const events=[];c.onMessage=x=>{if(x.method==='turn/completed')done(x.params.turn);if(x.method==='error')events.push(x.params);};let timer;try{await c.rpc('turn/start',{threadId:id,input:[{type:'text',text:'Use the explicitly attached synthetic skill. No tools or external action.'},{type:'skill',name:'read-'+version,path:paths[version]}]});const final=await Promise.race([completion,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('bounded turn timeout')),15000))]);assert.equal(final.status,'completed',JSON.stringify(events));assert(result.requests.length>before);const relevant=result.requests.slice(before).filter(r=>r[version+'Body']);assert(relevant.length>0);for(const r of relevant)assert.equal(r[(version==='v1'?'v2':'v1')+'Body'],false);return{status:final.status,requests:relevant};}finally{clearTimeout(timer);}}
async function tool(c,id,version){const output=await c.rpc('mcpServer/tool/call',{threadId:id,server:'m10_marker',tool:'fixed_marker',arguments:{}});const value=JSON.parse(output.content.find(x=>x.type==='text').text);assert.equal(value.packageHash,packages[version].packageHash);assert.equal(value.skillSha256,result.skills[version].sha256);assert.equal(value.marker,'M10_FIXED_TOOL_'+version);return{status:'passed',value};}
async function discover(c,version){
 const list=await c.rpc('skills/list',{cwds:[cwd],forceReload:true});
 const skills=list.data.flatMap(x=>x.skills).filter(s=>s.name.startsWith('read-')).map(({name,enabled,path})=>({name,enabled,path}));
 for(const v of ['v1','v2'])assert(skills.some(s=>s.name==='read-'+v&&s.enabled===(v===version)));
 return skills;
}
try{
 const one=await launch('concurrent-v1','v1');
 const first=await one.rpc('thread/start',{cwd,ephemeral:false,sandbox:'read-only',approvalPolicy:'never'});
 // Initialize shared native DB before starting second process; both remain live for all checks.
 const two=await launch('concurrent-v2','v2');
 const second=await two.rpc('thread/start',{cwd,ephemeral:false,sandbox:'read-only',approvalPolicy:'never'});
 result.threads={v1:first.thread.id,v2:second.thread.id};
 assert.notEqual(first.thread.id,second.thread.id);
 result.concurrentPids=[one.child.pid,two.child.pid];
 assert.equal(one.child.exitCode,null);assert.equal(two.child.exitCode,null);
 result.discovery={v1:await discover(one,'v1'),v2:await discover(two,'v2')};
 const outcomes=await Promise.allSettled([
  turn(one,first.thread.id,'v1'),turn(two,second.thread.id,'v2')
 ]);
 for(const [i,outcome] of outcomes.entries()){if(outcome.status==='rejected')throw outcome.reason;result.checks.push({name:'concurrent body read v'+(i+1),...outcome.value});}
 for(const [c,id,v] of [[one,first.thread.id,'v1'],[two,second.thread.id,'v2']])result.checks.push({name:'concurrent fixed tool '+v,...await tool(c,id,v)});
 await one.close();
 const resumed=await launch('resume-v1-while-v2-live','v1');
 const restored=await resumed.rpc('thread/resume',{threadId:first.thread.id,cwd,sandbox:'read-only',approvalPolicy:'never'});
 assert.equal(restored.thread.id,first.thread.id);assert.equal(two.child.exitCode,null);
 result.resumedDiscovery=await discover(resumed,'v1');
 result.checks.push({name:'resume old v1 body with v2 still alive',...await turn(resumed,restored.thread.id,'v1')});
 result.checks.push({name:'resume old v1 fixed tool',...await tool(resumed,restored.thread.id,'v1')});
 result.checks.push({name:'v2 fixed tool remains unchanged after v1 restart',...await tool(two,second.thread.id,'v2')});
 result.status='passed-with-boundaries';
}catch(e){result.status='failed';result.error=String(e);process.exitCode=1;}finally{await Promise.all(clients.map(c=>c.close()));result.allChildrenExited=clients.every(c=>c.child.exitCode!==null||c.child.signalCode!==null);for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await Promise.all(evidenceWrites);result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,error:result.error,root}));}
