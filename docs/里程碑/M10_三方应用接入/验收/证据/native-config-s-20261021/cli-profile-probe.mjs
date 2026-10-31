import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root=await mkdtemp('/private/tmp/m10-codex-config-s-'),home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project/inner'),executable='/Users/liubu/.local/bin/codex';
const report={schema:'m10-isolated-native-cli-config-v1',startedAt:new Date().toISOString(),root,executable,cliVersion:execFileSync(executable,['--version'],{encoding:'utf8'}).trim(),layer:'actual Codex exec + private loopback synthetic Responses provider; no real model or business data; not packaged WillYou/TUI/resume acceptance',cases:[],requests:[],status:'running',nativeSemantics:'0.162.1 per-path state retains lower entries absent from a higher array;an explicit later entry for the same path wins. Positive-control metadata observer;no claim of a real-model Skill read.',isolation:{freshHome:true,freshCodexHome:true,dailyCredentialsCopied:false,dailyConfigCopied:false,proxy:'unreachable loopback for non-local traffic',model:'private loopback synthetic response only',toolsRequested:0}};
assert.equal(report.cliVersion,'codex-cli 0.162.1');
assert(!existsSync('/etc/codex/config.toml'),'System Codex configuration exists; do not make an unproved isolated-layer claim');
for(const p of [home,state,join(cwd,'.git'),join(home,'.agents/skills/m10-profile-owned')])await mkdir(p,{recursive:true});
const skill=join(home,'.agents/skills/m10-profile-owned/SKILL.md');await writeFile(skill,'---\nname: m10-profile-owned\ndescription: Harmless isolated configuration-layer marker.\n---\nOnly fixture instructions.\n');
const sockets=new Set(),children=[];
const server=createServer((req,res)=>{let chunks=[],bytes=0;req.on('data',data=>{bytes+=data.length;if(bytes>4*1024*1024)req.destroy();else chunks.push(data)});req.on('end',()=>{if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{res.writeHead(400);res.end('{}');return;}
 const raw=JSON.stringify(body);report.requests.push({at:new Date().toISOString(),path:req.url,model:body.model,ownSkillMetadataPresent:raw.includes('m10-profile-owned'),requestBytes:bytes,sha256:createHash('sha256').update(raw).digest('hex')});
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 const message={id:'msg_m10_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'M10_CONFIGURATION_PROBE_DONE',annotations:[]}]};
 const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
 send('response.created',{response:{id:'resp_m10_fixture',object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
 send('response.output_item.added',{output_index:0,item:{...message,status:'in_progress',content:[]}});
 send('response.content_part.added',{item_id:message.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
 send('response.output_text.delta',{item_id:message.id,output_index:0,content_index:0,delta:'M10_CONFIGURATION_PROBE_DONE'});
 send('response.output_text.done',{item_id:message.id,output_index:0,content_index:0,text:'M10_CONFIGURATION_PROBE_DONE'});
 send('response.content_part.done',{item_id:message.id,output_index:0,content_index:0,part:message.content[0]});
 send('response.output_item.done',{output_index:0,item:message});
 send('response.completed',{response:{id:'resp_m10_fixture',object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[message],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();
});});server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
const config='model="m10-base-model"\nmodel_provider="m10_local_fixture"\nnotify=[]\n[model_providers.m10_local_fixture]\nname="M10 Local Synthetic Fixture"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n';
const profile='model="m10-profile-model"\nskills.config=[{path='+JSON.stringify(skill)+',enabled=false}]\n';
await writeFile(join(state,'config.toml'),config);await writeFile(join(state,'review.config.toml'),profile);
const relativeProfile='model="m10-relative-model"\nskills.config=[{path="../home/.agents/skills/m10-profile-owned/SKILL.md",enabled=false}]\n';await writeFile(join(state,'relative.config.toml'),relativeProfile);
const env={PATH:process.env.PATH,HOME:home,CODEX_HOME:state,TERM:'dumb',HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
async function run(name,args,model,skillExpected){
 const before=report.requests.length;const argv=['--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','exec',...args,'--ephemeral','--sandbox','read-only','--skip-git-repo-check','--color','never','--json','Reply exactly M10_CONFIGURATION_PROBE_DONE. Do not call any tool or access any file.'];
 const child=spawn(executable,argv,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});children.push(child);let stdout='',stderr='';child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
 console.log(JSON.stringify({case:name,status:'running',pid:child.pid}));
 const exit=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGTERM')}catch{};setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL')}catch{}},2000).unref();reject(new Error('Owned native CLI case timed out'))},45000);child.once('error',error=>{clearTimeout(timer);reject(error)});child.once('exit',(code,signal)=>{clearTimeout(timer);resolve({code,signal})});});
 await writeFile(join(root,name+'.stdout.txt'),stdout);await writeFile(join(root,name+'.stderr.txt'),stderr);
 const requests=report.requests.slice(before);const value={name,args,exit,requests,replyMarker:stdout.includes('M10_CONFIGURATION_PROBE_DONE'),status:'failed'};report.cases.push(value);
 assert.equal(exit.code,0,stderr.slice(-1400));assert(requests.length>0,'No private fixture request');assert(requests.every(r=>r.model===model),'Native model configuration differs from the declared layer');assert(requests.every(r=>r.ownSkillMetadataPresent===skillExpected),'Native Skill enable configuration differs from the declared layer');assert(value.replyMarker,'Native CLI did not finish the synthetic answer');value.status='passed';console.log(JSON.stringify({case:name,status:'passed',requests:requests.length}));
}
try{
 console.log(JSON.stringify({root,status:'starting',port,cli:report.cliVersion}));
 await run('baseline-positive-control',[],'m10-base-model',true);
 await run('profile',['--profile','review'],'m10-profile-model',false);
 await run('cli-replaces-profile',['--profile','review','-c','model="m10-cli-model"','--config','skills.config=[]'],'m10-cli-model',false);
 await run('inline-config',['--profile=review','--config=model="m10-inline-model"','-cskills.config=[]'],'m10-inline-model',false);
 await run('explicit-same-path-reenable',['--profile','review','-c','model=m10-unquoted-model','--config','skills.config=[{path='+JSON.stringify(skill)+',enabled=true}]'],'m10-unquoted-model',true);
 await run('profile-relative-origin',['--profile','relative'],'m10-relative-model',false);
 assert.equal(await readFile(join(state,'relative.config.toml'),'utf8'),relativeProfile);
 assert.equal(await readFile(join(state,'config.toml'),'utf8'),config);assert.equal(await readFile(join(state,'review.config.toml'),'utf8'),profile);report.originalConfigBytesUnchanged=true;report.status='passed-with-boundaries';
}catch(error){report.status='failed';report.error=String(error);report.stack=error.stack;process.exitCode=1;}
finally{for(const child of children)if(child.exitCode===null&&child.signalCode===null)try{process.kill(-child.pid,'SIGTERM')}catch{};for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));report.allOwnedChildrenTerminal=children.every(c=>c.exitCode!==null||c.signalCode!==null);report.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(report,null,2)+'\n');await writeFile('/private/tmp/m10-native-config-s-20261021/native-cli-result-path.txt',join(root,'result.json')+'\n');console.log(JSON.stringify({status:report.status,cases:report.cases.map(c=>({name:c.name,status:c.status})),error:report.error,result:join(root,'result.json')}));}
