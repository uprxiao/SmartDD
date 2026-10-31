// Actual project MCP + standard Skill + native OpenSSH, against a private SSH2
// endpoint that executes only one exact cat of a self-authored fixture file.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import ssh2 from 'ssh2';
const sha=b=>createHash('sha256').update(b).digest('hex');
const sh=s=>"'"+s.replaceAll("'","'\\''")+"'";
const text=o=>typeof o==='string'?o:o.map(x=>x.text??'').join('\n');
export async function projectResourceProbe({root,home,marker,contextOnly=false}){
 const host=ssh2.utils.generateKeyPairSync('ed25519'),clientKey=ssh2.utils.generateKeyPairSync('ed25519'),publicKey=ssh2.utils.parseKey(clientKey.public);assert(!(publicKey instanceof Error));
 const keyPath=join(root,'private-client-key'),bin=join(root,'isolated-bin'),serverRoot=join(root,'private-ssh-files'),file=join(serverRoot,'readonly-marker.txt'),knownHosts=join(root,'private-known-hosts');
 for(const path of [bin,serverRoot])await mkdir(path,{recursive:true});await writeFile(keyPath,clientKey.private,{flag:'wx',mode:0o600});await writeFile(file,marker+'_SSH_CONTENT\n',{flag:'wx',mode:0o600});
 const wrapper='#!/bin/sh\nexec /usr/bin/ssh -F /dev/null -o GlobalKnownHostsFile=/dev/null -o UserKnownHostsFile='+sh(knownHosts)+' "$@"\n';await writeFile(join(bin,'ssh'),wrapper,{flag:'wx',mode:0o700});
 const python=execFileSync('python3',['-c','import sys; print(sys.executable)'],{encoding:'utf8'}).trim();assert(python.startsWith('/'));
 const command='/bin/cat '+sh(file),clients=new Set(),children=new Set(),record={layer:'Actual App/PTY/Codex/project MCP/standard Python/OpenSSH/key auth; private SSH2 endpoint and loopback Responses, no UI or database-query claim',authentication:[],executed:[],commandChildren:[],phases:[],keyPublicSha256:sha(publicKey.getPublicSSH()),pythonExecutable:python,wrapper:{path:join(bin,'ssh'),sha256:sha(wrapper),scope:'Only adds -F /dev/null and private known_hosts; preserves original arguments/auth/command; explicit child PATH retains this shim after any shell rc; no daily ssh config or known_hosts'},databaseBoundary:'Project database requires saved encrypted password; no fake App cipher or daily credentials. DB query remains pending.'};
 const server=new ssh2.Server({hostKeys:[host.private]},client=>{
  clients.add(client);client.on('error',()=>{});client.on('close',()=>clients.delete(client));
  client.on('authentication',ctx=>{
   const ok=ctx.username==='m10-private'&&ctx.method==='publickey'&&ctx.key.algo===publicKey.type&&ctx.key.data.equals(publicKey.getPublicSSH())&&(!ctx.signature||publicKey.verify(ctx.blob,ctx.signature,ctx.hashAlgo)===true);
   record.authentication.push({method:ctx.method,accepted:ok,signed:!!ctx.signature});ok?ctx.accept():ctx.reject(['publickey']);
  });
  client.on('ready',()=>client.on('session',(accept)=>{
   const session=accept();session.on('pty',acceptPty=>acceptPty?.());
   session.on('exec',(acceptExec,reject,info)=>{
    if(info.command!==command){record.executed.push({allowed:false,commandSha256:sha(info.command)});reject?.();return;}
    const stream=acceptExec(),child=spawn('/bin/sh',['-c',command],{cwd:serverRoot,env:{PATH:'/usr/bin:/bin',HOME:home},stdio:['ignore','pipe','pipe']});children.add(child);record.executed.push({allowed:true,command});record.commandChildren.push({pid:child.pid});
    const timer=setTimeout(()=>child.kill('SIGKILL'),5000);child.stdout.on('data',b=>stream.write(b));child.stderr.on('data',b=>stream.stderr.write(b));child.on('error',()=>{});child.once('close',(code,signal)=>{clearTimeout(timer);children.delete(child);Object.assign(record.commandChildren.find(x=>x.pid===child.pid),{code,signal});stream.exit(code??1);stream.end();});
   });
  }));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});record.port=server.address().port;
 record.contextOnly=contextOnly;if(contextOnly)record.sshCoverage={status:'not-executed-in-this-independent-control',reason:'Original MA full attempt on fixed App was denied by native read-only sandbox while appending the required audit; no authentication/remote command occurred. Approval/sandbox unchanged; SSH remains pending.'};
 let phase,resource;
 function emit(body,res,item){
  const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n'),id='resp_m4_'+phase.name+'_'+phase.calls.length;
  send('response.created',{response:{id,status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',...(item.type==='function_call'?{arguments:''}:{content:[]})}});
  if(item.type==='function_call'){send('response.function_call_arguments.delta',{item_id:item.id,output_index:0,delta:item.arguments});send('response.function_call_arguments.done',{item_id:item.id,output_index:0,arguments:item.arguments});}
  else{const value=item.content[0].text;send('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:value});send('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:value});send('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part:item.content[0]});}
  send('response.output_item.done',{output_index:0,item});send('response.completed',{response:{id,status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
 }
 function call(body,res,name,args,namespace){const callId='m4_'+phase.name+'_'+phase.calls.length,call={type:'function_call',id:'fc_'+callId,call_id:callId,name,arguments:JSON.stringify(args),status:'completed',...(namespace?{namespace}:{})};phase.calls.push(call);emit(body,res,call);return true;}
 return {
  record,env:{PATH:bin+':'+process.env.PATH},
  async prepare(app,project){
   resource=await app.invoke('servers.create',project.id,{env:'test',label:'M10 private key SSH',aliases:['m10-private-server'],host:'127.0.0.1',port:record.port,username:'m10-private',authType:'key',privateKeyPath:keyPath,defaultRoot:false,sudoPolicy:'none',appRoot:serverRoot,logsPath:null,note:'Self-authored private read-only resource',password:null,passphrase:null,sudoPassword:null});record.serverId=resource.id;assert(!resource.hasPassword&&!resource.hasPassphrase&&!resource.hasSudoPassword);
  },
  respond(body,res){
   if(!phase||!JSON.stringify(body).includes(phase.marker))return false;
   for(const call of phase.calls){const output=(body.input??[]).find(x=>x.type==='function_call_output'&&x.call_id===call.call_id);if(output&&!phase.outputs.some(x=>x.call_id===call.call_id))phase.outputs.push(output);}
   if(!phase.calls.length){const ns=body.tools.find(x=>x.type==='namespace'&&x.name?.startsWith('mcp__smartdd_project_')&&x.tools?.some(t=>t.name==='project_context'));assert(ns);return call(body,res,'project_context',{},ns.name);}
   const raw=text(phase.outputs[0]?.output??''),start=raw.indexOf('{');assert(start>=0);const context=JSON.parse(raw.slice(start));assert.equal(context.projectId,phase.projectId);assert(context.servers.some(s=>s.resourceId===resource.id));assert.deepEqual(context.databases,[]);assert(!raw.includes('PRIVATE KEY'));phase.context=context;
   if(phase.calls.length===1)return call(body,res,'exec_command',{cmd:'/bin/cat '+phase.skills.map(s=>sh(s.path)).join(' '),max_output_tokens:5000,yield_time_ms:1000});
   assert(phase.skills.every(s=>text(phase.outputs[1]?.output??'').includes(s.contents.trim())),'Both entire original standard Skills must be read by actual native command');
   if(phase.calls.length===2){
    if(contextOnly){const ns=body.tools.find(x=>x.type==='namespace'&&x.tools?.some(t=>t.name==='smartdd_mail_draft_list_v1'));assert(ns);return call(body,res,'smartdd_mail_draft_list_v1',{},ns.name);}
    const script=join(dirname(phase.skills.find(s=>s.skillId==='remote-password-ssh').path),'scripts/remote_ssh.py');return call(body,res,'exec_command',{cmd:'/usr/bin/env PATH='+sh(bin+':/usr/bin:/bin')+' '+sh(python)+' '+sh(script)+' --target '+sh(resource.id)+' --no-root --command '+sh(command),max_output_tokens:2000,yield_time_ms:10000});
   }
   if(contextOnly){const raw=text(phase.outputs[2]?.output??''),start=raw.indexOf('{');assert(start>=0);assert(JSON.parse(raw.slice(start)).items.some(d=>d.id===phase.originalDraftId));}
   else assert(text(phase.outputs[2]?.output??'').includes(marker+'_SSH_CONTENT'),'Actual standard Skill/OpenSSH must return the private file');
   emit(body,res,{id:'msg_'+phase.name,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:phase.marker+'_DONE',annotations:[]}]});phase.done=true;return true;
  },
  async run({app,task,result,project,poll,checked}){
   result.projectResources=record;const original=await app.invoke('applications.session',task.id);assert(original.ok);const first=await app.invoke('tasks.get',task.id),fixed=original.value.snapshotHash,nativeId=first.nativeSessionId;assert(nativeId);
   async function round(name){
    const current=await app.invoke('tasks.get',task.id);assert.equal(current.nativeSessionId,nativeId);phase={name,marker:marker+'_M4_PROJECT_'+name,projectId:project.id,originalDraftId:result.createdDraft.id,calls:[],outputs:[],skills:[],done:false};record.phases.push(phase);
    for(const id of ['project-db-diagnostics','remote-password-ssh']){const rows=current.runtimeSnapshot.skills.filter(s=>s.enabled&&s.skillId===id);assert.equal(rows.length,1);const s=rows[0],contents=await readFile(s.path,'utf8');phase.skills.push({skillId:id,path:s.path,hash:s.hash,fileSha256:sha(contents),contents});}
    await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:current.ptyId,data:phase.marker+': Read project context and both standard Skills, then run the exact private read-only SSH probe. No writes, sudo or external actions.'})});true`);await poll(async()=>(await app.output(current.ptyId)).includes(phase.marker),10000);await app.evaluate(`window.electronAPI.eventSend('pty:input',${JSON.stringify({taskId:task.id,ptyId:current.ptyId,data:'\r'})});true`);await poll(async()=>phase.done&&(await app.output(current.ptyId)).includes(phase.marker+'_DONE'),30000);
    const d=await app.invoke('applications.session',task.id);assert(d.ok);assert.equal(d.value.snapshotHash,fixed);assert(d.value.currentRun.bridge.connected);phase.runId=d.value.currentRun.id;phase.diagnostic=d.value;phase.terminal=await app.output(current.ptyId);
    checked('Actual '+name+' project MCP returns the original project/server and both complete standard Skills are read without duplicate paths');
    checked(contextOnly?'Actual '+name+' Mail MCP retrieves the original draft while project context and both standard Skills remain available; SSH execution is pending separately':'Actual '+name+' standard SSH script/OpenSSH performs signed key authentication and reads only the private remote fixture, while M10 remains connected');
   }
   await round('initial');await app.invoke('tasks.kill',task.id);await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&!d.value.currentRun&&d.value.recentRuns.every(r=>r.state==='stopped');});
   await app.invoke('tasks.open',{taskId:task.id,cols:100,rows:30});await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.currentRun?.bridge.connected;},45000);await round('resumed');
   assert.notEqual(record.phases[0].runId,record.phases[1].runId);assert.deepEqual(record.phases[0].skills,record.phases[1].skills);assert.equal(record.executed.length,contextOnly?0:2);assert(record.executed.every(x=>x.allowed));assert(contextOnly?record.authentication.length===0:record.authentication.filter(x=>x.accepted&&x.signed).length>=2);assert(record.commandChildren.every(x=>x.code===0&&!x.signal));assert.equal(await readFile(file,'utf8'),marker+'_SSH_CONTENT\n');
   await app.invoke('tasks.kill',task.id);await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&!d.value.currentRun&&d.value.recentRuns.every(r=>r.state==='stopped');});record.nativeId=nativeId;record.snapshotHash=fixed;record.status=contextOnly?'passed-context-partial-ssh-pending':'passed-ssh-and-context-partial';
   checked('Normal stop/resume keeps actual native ID, fixed S, original standard Skill paths/hashes and private SSH data, with no automatic DB or App changes');
  },
  async close(){for(const child of children)child.kill('SIGKILL');for(const client of clients)client.end();await new Promise(resolve=>server.close(resolve));record.closed=true;record.remainingCommandChildren=children.size;},
 };
}
