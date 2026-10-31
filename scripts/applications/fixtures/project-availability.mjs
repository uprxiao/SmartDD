// Explicit local Responses fixture plus real packaged-UI actions for T31.
// Only model responses are synthetic. No auth, IPC or business result is replaced.
import assert from 'node:assert/strict';
import {join} from 'node:path';

export function availabilityProbe(marker,input={},toolName='smartdd_mail_query_v1'){
 let phase=null;
 const records=[];
 const text=output=>typeof output==='string'?output:output.map(block=>block.text??'').join('\n');
 const frame=(res,type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
 return {
  records,
  select(name){phase={name,call:null,output:null,done:false};records.push(phase);return phase;},
  respond(body,res){
   if(!phase||!JSON.stringify(body).includes(marker)||JSON.stringify(body).includes(marker+'_PROJECT_B'))return false;
   const send=(type,value)=>frame(res,type,value),id='availability_'+phase.name;
   if(!phase.call){
    const ns=(body.tools??[]).find(tool=>tool.type==='namespace'&&tool.tools?.some(t=>t.name===toolName));
    assert(ns,'The original native Mail query tool must still be discoverable');
    const argumentsJson=JSON.stringify(input),call={type:'function_call',id:'fc_'+id,call_id:'call_'+id,name:toolName,namespace:ns.name,arguments:argumentsJson,status:'completed'};phase.call=call;
    send('response.created',{response:{id,object:'response',status:'in_progress',output:[]}});
    send('response.output_item.added',{output_index:0,item:{...call,status:'in_progress',arguments:''}});
    send('response.function_call_arguments.delta',{item_id:call.id,output_index:0,delta:argumentsJson});
    send('response.function_call_arguments.done',{item_id:call.id,output_index:0,arguments:argumentsJson});
    send('response.output_item.done',{output_index:0,item:call});
    send('response.completed',{response:{id,object:'response',status:'completed',model:body.model,output:[call],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();return true;
   }
   const output=(body.input??[]).find(item=>item.type==='function_call_output'&&item.call_id===phase.call.call_id);assert(output,'Actual native tool result required');phase.output=output;
   const raw=text(output.output),first=raw.indexOf('{'),last=raw.lastIndexOf('}');
   const closed='tool call error: tool call failed for `'+phase.call.namespace.replace(/^mcp__/,'')+'/'+phase.call.name+'`\n\nCaused by:\n    Transport closed';
   if(phase.stopRequestedAt&&raw.replace(/^Wall time: [0-9.]+ seconds\s+Output:\s*/,'').trim()===closed){phase.transportClosed=true;}
   else{assert(first>=0&&last>=first,raw);phase.value=JSON.parse(raw.slice(first,last+1));}
   const done=marker+'_AVAIL_'+phase.name+'_DONE',message={id:'msg_'+id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:done,annotations:[]}]};
   send('response.created',{response:{id,object:'response',status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...message,status:'in_progress',content:[]}});send('response.content_part.added',{item_id:message.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send('response.output_text.delta',{item_id:message.id,output_index:0,content_index:0,delta:done});send('response.output_text.done',{item_id:message.id,output_index:0,content_index:0,text:done});send('response.content_part.done',{item_id:message.id,output_index:0,content_index:0,part:message.content[0]});send('response.output_item.done',{output_index:0,item:message});send('response.completed',{response:{id,object:'response',status:'completed',model:body.model,output:[message],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();phase.done=true;return true;
  },
  clear(){phase=null;},
 };
}

export async function checkProjectAvailability({app,result,root,marker,probe,project,other,task,connections,click,key,poll,checked}){
 const unwrap=r=>{assert(r.ok,JSON.stringify(r));return r.value;},read=async()=>unwrap(await app.invoke('applications.projectSettings',project.id,'mail'));
 const original=unwrap(await app.invoke('applications.session',task.id)),native=(await app.invoke('tasks.get',task.id)).nativeSessionId;
 async function chooseProject(target){
  const selector='select[aria-label="当前应用项目"]';await app.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
  if(await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(target.id)}`))return;
  for(let n=0;n<180;n++){if(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})===true`))break;await key('Tab','Tab',9);}
  assert(await app.evaluate(`document.activeElement?.matches(${JSON.stringify(selector)})===true`));
  for(const ch of target.name)await app.cdp('Input.dispatchKeyEvent',{type:'char',key:ch,text:ch});await app.waitFor(`document.querySelector(${JSON.stringify(selector)}).value===${JSON.stringify(target.id)}`);await key('Tab','Tab',9);
 }
 async function enterApps(){if(!await app.evaluate('!!document.querySelector(".m10-shell .m10-sidebar")')){await click('[data-testid=nav-apps]');await app.waitFor('!!document.querySelector(".m10-sidebar")');}}
 async function projectPage(target=project){await enterApps();await click('.m10-sidebar button','项目选用');await chooseProject(target);await app.waitFor(`!!document.querySelector('[aria-label='+${JSON.stringify(JSON.stringify('为'+target.name+'启用邮件'))}+']')`);}
 async function connectionEnabled(connection,enabled){
  await enterApps();await app.waitFor('!!document.querySelector(".m10-nav.installed")');await click('.m10-nav.installed','邮件');const selector='[aria-label='+JSON.stringify('启用'+connection.name)+']';await app.waitFor(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);
  if(await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-checked')===${JSON.stringify(String(enabled))}`))return;
  await click(selector);await app.waitFor(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-checked')===${JSON.stringify(String(enabled))}&&!document.querySelector(${JSON.stringify(selector)}).disabled`);
 }
 async function selectSource(connection){const selector='input[aria-label='+JSON.stringify('为'+project.name+'选用'+connection.name)+']';await app.waitFor(`!!document.querySelector(${JSON.stringify(selector)})&&!document.querySelector(${JSON.stringify(selector)}).disabled`);await click(selector);await poll(async()=>(await read()).connections.foxmail===connection.id);assert(await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).checked`));}
 async function nativeQuery(name,expected){
  await click('[data-testid=nav-home]');await app.waitFor(`!!document.querySelector('[data-testid=sidebar-task][data-task-id="'+${JSON.stringify(task.id)}+'"]')`);await click('[data-testid=sidebar-task][data-task-id="'+task.id+'"]');await app.waitFor(`document.querySelector('[data-testid=task-header]')?.textContent.includes(${JSON.stringify(task.title)})`);
  const phase=probe.select(name),prompt=marker+'_AVAIL_'+name+': Query the explicitly selected local mailbox once. No writes or sending.';
  await click('.xterm-helper-textarea');await app.cdp('Input.insertText',{text:prompt});await poll(async()=>(await app.output(task.ptyId)).includes(marker+'_AVAIL_'+name),10000);await new Promise(done=>setTimeout(done,350));for(const type of ['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:36,...(type==='keyDown'?{text:'\r'}:{})});
  await poll(async()=>phase.done&&(await app.output(task.ptyId)).includes(marker+'_AVAIL_'+name+'_DONE'),30000);
  if(expected==='success')assert.equal(phase.value.error,undefined,JSON.stringify(phase.value));else assert.equal(phase.value.error?.code,expected,JSON.stringify(phase.value));
  const current=unwrap(await app.invoke('applications.session',task.id)),alive=await app.invoke('tasks.get',task.id);assert.equal(current.currentRun.id,original.currentRun.id);assert.equal(current.snapshotHash,original.snapshotHash);assert.equal(alive.ptyId,task.ptyId);assert.equal(alive.nativeSessionId,native);probe.clear();checked('T31 original native run '+name+' returns '+expected+' without restarting or replacing its fixed selection');return phase;
 }
 await projectPage();const initial=await read();assert.equal(initial.connections.foxmail,connections[0].id);assert(await app.evaluate(`document.querySelector('fieldset legend')!==null&&document.body.innerText.includes('SMTP 发件账号')&&document.body.innerText.includes('本地读取来源')`));await nativeQuery('ready','success');
 await connectionEnabled(connections[1],false);await projectPage();await selectSource(connections[1]);assert(await app.evaluate(`Array.from(document.querySelectorAll('label')).find(e=>e.textContent.includes(${JSON.stringify(connections[1].name)}))?.textContent.includes('已停用')`));await nativeQuery('selected-disabled','AUTH_REQUIRED');
 await projectPage();await selectSource(connections[0]);await chooseProject(other);const b=unwrap(await app.invoke('applications.projectSettings',other.id,'mail'));assert(!b.enabled);assert.equal(b.connections.foxmail,null);await chooseProject(project);assert.equal((await read()).connections.foxmail,connections[0].id);checked('T31 real UI project switch preserves A selection, B empty selection and distinct read/send categories');
 await connectionEnabled(connections[0],false);await projectPage();const held=await read();assert.equal(held.connections.foxmail,connections[0].id);await app.screenshot(join(root,'t31-disabled-selected-source.png'));
 await click('[data-testid=nav-home]');await app.waitFor(`!!document.querySelector('[data-testid=sidebar-task][data-task-id="'+${JSON.stringify(task.id)}+'"]')`);await click('[data-testid=sidebar-task][data-task-id="'+task.id+'"]');await app.waitFor('!!document.querySelector("[data-testid=task-applications]")');await click('[data-testid=task-applications]');await app.waitFor(`document.querySelector('[data-testid=session-applications]')?.innerText.includes('邮件来源：'+${JSON.stringify(connections[0].name)}+' · 已停用')`);await app.screenshot(join(root,'t31-original-session-disabled.png'));await click('dialog button','关闭');await nativeQuery('original-connection-disabled','AUTH_REQUIRED');
 await connectionEnabled(connections[0],true);await nativeQuery('same-identity-restored','success');await connectionEnabled(connections[1],true);
 result.projectAvailability={initial,held,originalRunId:original.currentRun.id,nativeSessionId:native,phases:probe.records};
}
