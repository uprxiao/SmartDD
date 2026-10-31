// T55: actual native user Skill read and unaffected Mail MCP use in one Task.
// Only the Responses provider selects these two private read-only operations.
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const text=value=>typeof value==='string'?value:value.map(x=>x.text??'').join('\n');
export function mixedAppConflictProbe(marker){
 const id=marker+'_MIXED_APPS',record={marker:id,calls:[],outputs:[],catalogs:[],done:false};let path,contents;
 function emit(body,res,item){
  const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
  send('response.created',{response:{id,status:'in_progress',output:[]}});
  send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',...(item.type==='function_call'?{arguments:''}:{content:[]})}});
  if(item.type==='function_call'){
   send('response.function_call_arguments.delta',{item_id:item.id,output_index:0,delta:item.arguments});send('response.function_call_arguments.done',{item_id:item.id,output_index:0,arguments:item.arguments});
  }else{
   const value=item.content[0].text;send('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:value});send('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text:value});send('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part:item.content[0]});
  }
  send('response.output_item.done',{output_index:0,item});send('response.completed',{response:{id,status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
 }
 return {
  record,
  respond(body,res){
   if(!path||!JSON.stringify(body).includes(id))return false;
   const functions=(body.tools??[]).flatMap(x=>x.name?.startsWith('mcp__wy_')?(x.tools??[]).map(t=>({namespace:x.name,name:t.name})):[]);assert(functions.some(f=>f.name==='smartdd_mail_draft_list_v1'));assert(functions.every(f=>f.name.startsWith('smartdd_mail_')));record.catalogs.push(functions);
   for(const call of record.calls){const output=(body.input??[]).find(x=>x.type==='function_call_output'&&x.call_id===call.call_id);if(output&&!record.outputs.some(x=>x.call_id===call.call_id))record.outputs.push(output);}
   if(record.calls.length===0){
    const command='/bin/cat '+"'"+path.replaceAll("'","'\\''")+"'",call={type:'function_call',id:'fc_mixed_read',call_id:'call_mixed_read',name:'exec_command',arguments:JSON.stringify({cmd:command,max_output_tokens:1500,yield_time_ms:1000}),status:'completed'};record.calls.push(call);emit(body,res,call);return true;
   }
   assert(text(record.outputs.find(x=>x.call_id==='call_mixed_read')?.output??'').includes(contents.trim()),'Actual native cat must return the original entire user Skill');
   if(record.calls.length===1){
    const namespace=functions.find(f=>f.name==='smartdd_mail_draft_list_v1').namespace,call={type:'function_call',id:'fc_mixed_mail',call_id:'call_mixed_mail',name:'smartdd_mail_draft_list_v1',namespace,arguments:'{}',status:'completed'};record.calls.push(call);emit(body,res,call);return true;
   }
   const output=text(record.outputs.find(x=>x.call_id==='call_mixed_mail')?.output??''),start=output.indexOf('{');assert(start>=0);assert.deepEqual(JSON.parse(output.slice(start)).items,[]);
   emit(body,res,{id:'msg_mixed_done',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:id+'_DONE',annotations:[]}]});record.done=true;return true;
  },
  async run({app,result,root,home,index,appRoot,project,profile,originalTask,poll,checked}){
   const entry=index.apps.find(x=>x.appId==='zentao'),manifest=JSON.parse(await readFile(join(appRoot,'Contents/Resources/capability-bundles',entry.path,'manifest.json'),'utf8')),name='smartdd-a-zentao-'+manifest.skills[0].id+'-'+entry.hash.slice(0,12);
   path=join(home,'.agents/skills',name,'SKILL.md');contents='---\nname: '+name+'\ndescription: Private user-owned exact ZenTao Skill conflict.\n---\n\n'+id+'_USER_BODY\nNo changes or external actions.\n';await mkdir(dirname(path),{recursive:true});await writeFile(path,contents);record.userSkill={path,sha256:sha(contents)};result.mixedApps=record;
   const before=await app.invoke('applications.session',originalTask.id),original=await app.invoke('tasks.get',originalTask.id);assert(before.ok&&!before.value.currentRun);
   const catalog=await app.invoke('applications.catalog');assert(catalog.ok);const zen=catalog.value.find(x=>x.appId==='zentao');assert((await app.invoke('applications.setAdded','zentao',true,zen.revision)).ok);assert((await app.invoke('applications.select',{projectId:project.id,appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:null}})).ok);
   let task;
   try{
    const opened=await app.invoke('tasks.create',{projectId:project.id,dirId:null,aiProfileId:profile.id,firstMessage:id+': Read the original private user Skill once, then list Mail drafts only. No changes, credentials or external actions.',cols:100,rows:30});task=opened.task;record.taskId=task.id;
    await poll(async()=>record.done&&(await app.output(task.ptyId)).includes(id+'_DONE'),45000);
    const current=await poll(async()=>{const t=await app.invoke('tasks.get',task.id);return t.nativeSessionId?t:null;},15000),diagnostic=await app.invoke('applications.session',task.id);assert(diagnostic.ok);assert.notEqual(current.nativeSessionId,original.nativeSessionId);record.nativeId=current.nativeSessionId;record.diagnostic=diagnostic.value;
    const mail=diagnostic.value.applications.find(x=>x.appId==='mail'),zentao=diagnostic.value.applications.find(x=>x.appId==='zentao');assert(mail.packageHash&&zentao.packageHash);assert.equal(mail.issueCode,null);assert.equal(mail.evidence.successfulToolRequests,1);assert.equal(zentao.issueCode,'AGENT_CAPABILITY_NAME_CONFLICT');assert.equal(zentao.evidence.toolRequests,0);
    checked('Two selected Apps retain both fixed packages, exact user ZenTao Skill excludes only ZenTao, actual unaffected Mail MCP remains callable');
    // Independently prove native Skill discovery. A cat alone would not prove
    // that the user Skill remained enabled in Codex's actual developer catalog.
    const require=createRequire(import.meta.url),esbuildRequire=createRequire(require.resolve('vite/package.json')),cli=join(dirname(esbuildRequire.resolve('esbuild')),'../bin/esbuild'),parser=join(root,'production-discovery-parser.mjs'),source='src/main/core/applications/codex-skill-discovery-evidence.ts';
    execFileSync(cli,[source,'--bundle','--platform=node','--format=esm','--outfile='+parser],{stdio:'pipe',timeout:20000});
    const {codexSkillDiscoveryEvidence}=await import(pathToFileURL(parser).href),folder=join(result.state,'sessions'),files=(await readdir(folder,{recursive:true})).filter(p=>p.endsWith('.jsonl')&&p.includes(current.nativeSessionId));assert.equal(files.length,1);
    const lines=(await readFile(join(folder,files[0]),'utf8')).trimEnd().split('\n'),target={id:'original-user-zen',nativeName:name,path,content:contents},observations=codexSkillDiscoveryEvidence(lines,[target],Date.parse(result.startedAt),Date.now());assert.equal(observations.length,1,'Original user Skill must remain in the actual native catalog');
    assert.deepEqual(codexSkillDiscoveryEvidence(lines,[{...target,path:path+'.wrong'}],Date.parse(result.startedAt),Date.now()),[]);record.discovery={layer:'Actual native JSONL to unchanged production parser, separate from reading',observations,nativeFile:join(folder,files[0]),parserSourceSha256:sha(await readFile(source)),compiledSha256:sha(await readFile(parser))};
    assert.equal(await readFile(path,'utf8'),contents);assert(record.outputs.some(x=>x.call_id==='call_mixed_read'));record.terminal=await app.output(current.ptyId);
    checked('Same actual native Task reads entire original user-owned conflicting Skill and calls Mail draft_list; user bytes and all App business data remain unchanged');
    const after=await app.invoke('applications.session',originalTask.id);assert(after.ok);assert.equal(after.value.snapshotHash,before.value.snapshotHash);assert.equal((await app.invoke('tasks.get',originalTask.id)).nativeSessionId,original.nativeSessionId);record.originalTask={id:originalTask.id,snapshotHash:after.value.snapshotHash,nativeId:original.nativeSessionId};
    checked('Adding the second selected App and its new mixed Task preserves the stopped original Task native identity and fixed Mail-only S');
   }finally{
    if(task){await app.invoke('tasks.kill',task.id);record.afterStop=await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&!d.value.currentRun&&d.value.recentRuns.every(x=>x.state==='stopped')?d.value:null;},30000);}
   }
  },
 };
}
