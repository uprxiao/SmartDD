import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { codexToolReply, listedAvailable, nativeTool } from '../a26-recheck/codex-mcp.mjs';

export function defer(){
  let release;
  return {promise:new Promise(resolve=>{release=resolve;}),release:()=>release()};
}
export const models=Object.fromEntries(['codex','claude'].map(kind=>[kind,
  Object.fromEntries(['parent','writer','cancel'].map(role=>[role,'a32-'+kind+'-'+role]))]));
export const marker=name=>'A32_'+name.toUpperCase();
export const files={parent:'a32-parent-marker.txt',child:'a32-child-marker.txt',
  foregroundStarted:'a32-native-foreground-started',foregroundRelease:'a32-native-foreground-release',
  backgroundStarted:'a32-native-background-started',backgroundRelease:'a32-native-background-release',
  backgroundDone:'a32-native-background-done'};
export function claudeReply(body,id){
  const results=(body.messages??[]).flatMap(row=>Array.isArray(row.content)?row.content:[])
    .filter(part=>part.type==='tool_result'&&part.tool_use_id===id);
  assert.equal(results.length,1,'one Claude receipt for '+id);
  const [value]=results;
  assert(!value.is_error,'isolated native Claude tool rejected: '+JSON.stringify(value.content).slice(0,700));
  return typeof value.content==='string'?value.content:value.content.filter(part=>part.type==='text').map(part=>part.text).join('\n');
}
export function latestUserText(kind,body){
  const rows=kind==='claude'?body.messages:body.input;
  const content=(Array.isArray(rows)?rows.findLast(row=>row.role==='user'):null)?.content;
  return typeof content==='string'?content:Array.isArray(content)?
    content.filter(part=>part.type==='text'||part.type==='input_text').map(part=>part.text).join('\n'):'';
}
export function nativeBackgroundNotice(text,expectedTool){
  if(!expectedTool||!text.includes('[SYSTEM NOTIFICATION - NOT USER INPUT]'))return null;
  const note=/<task-notification>([\s\S]*?)<\/task-notification>/.exec(text)?.[1];
  if(!note)return null;
  const toolUseId=/<tool-use-id>([^<]+)<\/tool-use-id>/.exec(note)?.[1];
  const taskId=/<task-id>([a-z0-9-]+)<\/task-id>/.exec(note)?.[1];
  const status=/<status>([a-z_]+)<\/status>/.exec(note)?.[1];
  return toolUseId===expectedTool&&taskId&&status==='completed'?{toolUseId,taskId,status}:null;
}
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
function call(kind,body,name,args){
  const tool=kind==='codex'?nativeTool(body,name):(body.tools??[]).find(t=>t.name===name||t.name.endsWith('__'+name));
  assert(tool,'provider has no verified native tool '+name);
  if(name==='wy_delegate'){
    const schema=kind==='codex'?tool.parameters:tool.input_schema;
    assert.equal(schema?.properties?.profileRevision?.type,'string');
  }
  const callId=(kind==='claude'?'toolu_':'call_')+randomUUID().replaceAll('-','');
  return {tool,args,callId};
}
function hostReceipt(kind,body,id){
  if(kind==='codex')return codexToolReply(body,id);
  const returned=claudeReply(body,id);
  return JSON.parse(returned);
}
function commandReply(kind,body,id){
  if(kind==='claude')return claudeReply(body,id);
  const matches=(body.input??[]).filter(item=>item.type==='function_call_output'&&item.call_id===id);
  assert.equal(matches.length,1);
  return typeof matches[0].output==='string'?matches[0].output:JSON.stringify(matches[0].output);
}
export function fixtureCommands(cwd){
  assert.match(cwd,/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/(?:attempt-\d+|prep-next\/a32-recheck\/preflight-[A-Za-z0-9]+)\/runtime-[A-Za-z0-9]+\/(?:git|svn|plain)\/common$/);
  assert.equal(realpathSync(cwd),cwd);
  const path=name=>quote(join(cwd,files[name]));
  const waitFor=name=>"for tick in $(/usr/bin/seq 1 240); do if [ -e "+path(name)+" ]; then break; fi; /bin/sleep 0.2; done; test -e "+path(name)+" && ";
  const put=(file,text)=>'printf '+quote('%s\\n')+' '+quote(text)+' > '+path(file)+' && ';
  const begin='cd '+quote(cwd)+' && ';
  return {
    parent:begin+put('foregroundStarted',marker('foreground_exists'))+waitFor('foregroundRelease')+put('parent',marker('parent_bytes'))+'pwd -P && printf '+marker('parent_wrote'),
    background:begin+"printf '%s\\n' \"$$\" > "+path('backgroundStarted')+' && '+waitFor('backgroundRelease')+
      put('backgroundDone',marker('background_done'))+'true',
    child:begin+'/bin/cat '+path('parent')+' && '+put('child',marker('child_bytes'))+'pwd -P && printf '+marker('child_wrote'),
    resume:begin+'/bin/cat '+path('child')+' && pwd -P && printf '+marker('parent_read'),
  };
}
export function createWorkflow({parentKind,childKind,profiles,cwd,background,business}){
  const commands=fixtureCommands(cwd);
  assert(parentKind!==childKind);
  assert(!(background||business)||parentKind==='claude');
  assert(!(background&&business));
  const s={parentStep:0,childStep:0,closing:false,parentHeld:false,childHeld:false,receipts:{},toolProof:{},events:[],businessStep:0,
    parentGate:defer(),childGate:defer(),backgroundNoticeGate:defer(),businessGate:defer()};
  function make(kind,body,name,args,role){
    const toolCall=call(kind,body,name,args);
    if(role==='parent')s.parentCall=toolCall.callId;
    else s.childCall=toolCall.callId;
    s.events.push({kind,role,name,callId:toolCall.callId,at:Date.now()});
    return {call:toolCall,role,name};
  }
  function exec(kind,body,type,role){
    if(kind==='codex')return make(kind,body,'exec_command',{cmd:commands[type],workdir:cwd,max_output_tokens:100},role);
    return make(kind,body,'Bash',{command:commands[type],description:'WillYou isolated A32 '+type,
      ...(type==='background'?{run_in_background:true}:{})},role);
  }
  function issueDelegate(body,type){
    return make(parentKind,body,'wy_delegate',{
      requestKey:'a32-'+type+'-'+parentKind,profileId:s.target.profileId,profileRevision:s.target.revision,
      title:'A32 '+type+' '+childKind,model:models[childKind][type],instructions:marker(type),
      workspaceMode:'shared',access:'write',
    },'parent');
  }
  function commandProof(kind,body,id,tag,needPath=true){
    const value=commandReply(kind,body,id);
    assert(value.includes(tag),'native result missing '+tag+': '+value.slice(0,700));
    if(needPath)assert(value.includes(cwd),'native tool did not confirm exact working dir');
    return value.slice(0,800);
  }
  async function next(kind,body){
    if(s.closing)return {answer:'A32 cleanup',role:'cleanup'};
    if(body.model===models[childKind].cancel){
      assert.equal(kind,childKind);
      s.unexpectedCanceledArrival=Date.now();
      return {answer:marker('canceled_should_not_arrive'),role:'cancel'};
    }
    if(body.model===models[childKind].writer){
      assert.equal(kind,childKind);
      const step=s.childStep++;
      if(step===0){s.childStarted=Date.now();return exec(kind,body,'child','child');}
      assert.equal(step,1);
      s.toolProof.child=commandProof(kind,body,s.childCall,marker('child_wrote'));
      assert(s.toolProof.child.includes(marker('parent_bytes')));
      s.childHeld=true;
      await s.childGate.promise;
      s.childHeld=false;
      return {answer:marker('child_done'),role:'child'};
    }
    assert.equal(kind,parentKind);
    assert.equal(body.model,models[parentKind].parent);
    if(business&&s.businessStep<2){
      const step=s.businessStep++;
      if(step===0)return make(kind,body,business.tool,{marker:business.marker},'parent');
      const ack=hostReceipt(kind,body,s.parentCall);
      assert(/awaiting_user/.test(JSON.stringify(ack)),'native business request must return asynchronously');
      s.businessReceipt=ack;
      await s.businessGate.promise;
    }
    const step=s.parentStep++;
    if(step===0)return make(kind,body,'wy_targets',{},'parent');
    if(step===1){
      s.target=listedAvailable(hostReceipt(kind,body,s.parentCall),profiles[childKind]);
      return issueDelegate(body,'writer');
    }
    if(step===2){
      s.receipts.writer=hostReceipt(kind,body,s.parentCall);
      assert.equal(s.receipts.writer.state,'queued');
      assert.equal(s.receipts.writer.workspaceMode,'shared');
      return issueDelegate(body,'cancel');
    }
    if(step===3){
      s.receipts.cancel=hostReceipt(kind,body,s.parentCall);
      assert.equal(s.receipts.cancel.workspaceMode,'shared');assert.equal(s.receipts.cancel.state,'queued');
      assert.notEqual(s.receipts.cancel.childTaskId,s.receipts.writer.childTaskId);
      s.parentHeld=true;
      await s.parentGate.promise;
      s.parentHeld=false;
      return exec(kind,body,'parent','parent');
    }
    if(step===4){
      s.toolProof.parent=commandProof(kind,body,s.parentCall,marker('parent_wrote'));
      assert(s.receipts.writer&&s.receipts.cancel);
      if(background){
        const action=exec(kind,body,'background','parent');
        s.backgroundCall=action.call.callId;
        return action;
      }
      return {answer:marker('parent_foreground_done'),role:'parent'};
    }
    if(step===5&&background){
      s.toolProof.background=commandReply(kind,body,s.parentCall).slice(0,700);
      assert(s.toolProof.background.length);
      return {answer:marker('parent_foreground_done'),role:'parent'};
    }
    const latest=latestUserText(kind,body);
    const automated=kind==='claude'&&background&&nativeBackgroundNotice(latest,s.backgroundCall);
    if(automated){
      s.backgroundNotice={...automated,arrivedAt:Date.now(),heldForOwnershipProof:true};
      await s.backgroundNoticeGate.promise;
      return {answer:marker('background_notification_ack'),role:'original-parent-background'};
    }
    if(s.awaitingRead){
      s.toolProof.read=commandProof(kind,body,s.parentCall,marker('parent_read'));
      assert(s.toolProof.read.includes(marker('child_bytes')));
      s.awaitingRead=false;
      s.readCompleted=true;
      return {answer:marker('parent_resume_done'),role:'parent'};
    }
    if(!s.resumeStarted&&latest.includes(marker('resume'))){
      s.awaitingRead=true;
      s.resumeStarted=Date.now();
      return exec(kind,body,'resume','parent');
    }
    assert(latest.includes('宿主子任务结果通知')||business&&latest.includes('宿主业务结果通知'),
      'expected an actual host notification or explicit queued parent follow-up');
    s.notifications=(s.notifications??0)+1;
    return {answer:marker('parent_notice_done'),role:'parent'};
  }
  return {s,next,close(){s.closing=true;s.parentGate.release();s.childGate.release();s.backgroundNoticeGate.release();s.businessGate.release();}};
}
