import {randomUUID} from 'node:crypto';
import {z} from '/private/tmp/willyou-m14-owner-probe/node_modules/zod/index.js';
import {Kernel,Registry,hash} from './contract.mjs';
const id=z.string().min(1).max(128);
const Profile=z.strictObject({id,driverId:id,revision:z.number().int().positive(),schema:z.literal(1),enabled:z.boolean(),credentialRef:id,identity:id,model:id,root:id});
const cap=(state,reason='')=>({state,reason});
const requireCap=(caps,name)=>{const c=caps[name]??cap('unverified','missing declaration');if(c.state!=='supported')throw Error('CAPABILITY_'+name+'_'+c.state);};
export class Directory{
 constructor(resolveCredential=()=>true){this.definitions=new Map();this.profiles=new Map();this.revision=0;this.resolveCredential=resolveCredential;}
 register(d){if(!/^[a-z][a-z0-9-]*$/.test(d.id)||this.definitions.has(d.id)||typeof d.create!=='function'||typeof d.capabilities!=='function')throw Error('INVALID_DRIVER');this.definitions.set(d.id,d);}
 set(raw){const p=Profile.parse(raw),d=this.definitions.get(p.driverId);if(!d)throw Error('NO_DRIVER');const old=this.profiles.get(p.id);if(old&&p.revision<=old.revision)throw Error('CONFIG_REVISION');if(d.multiple===false&&[...this.profiles.values()].some(x=>x.id!==p.id&&x.driverId===p.driverId))throw Error('SINGLE_INSTANCE_DRIVER');this.profiles.set(p.id,Object.freeze(p));this.revision++;}
 resolve(id){const p=this.profiles.get(id);if(!p)throw Error('NO_PROFILE');if(!p.enabled)throw Error('PROFILE_DISABLED');if(!this.resolveCredential(p.credentialRef))throw Error('CREDENTIAL_UNAVAILABLE');const driver=this.definitions.get(p.driverId),caps=structuredClone(driver.capabilities(p));return {profile:p,driver,caps,capabilityHash:hash(caps),directoryRevision:this.revision};}
 validate(token){if(this.profiles.get(token.profile.id)!==token.profile)throw Error('CONFIG_CHANGED');if(hash(token.driver.capabilities(token.profile))!==token.capabilityHash)throw Error('CAPABILITIES_CHANGED');return token;}
 list(){return [...this.profiles.values()].map(p=>({id:p.id,driverId:p.driverId,revision:p.revision,enabled:p.enabled,model:p.model,capabilities:this.definitions.get(p.driverId).capabilities(p)}));}
}
export class Host{
 constructor(file,directory){this.directory=directory;this.runtimes=new Map();this.owners=new WeakMap();this.runtimeByRun=new Map();const registry=new Registry();for(const d of directory.definitions.values())registry.register({id:d.id,capabilities:{turns:cap('supported'),requests:cap('supported')},createNormalizer:scope=>this.runtimeByRun.get(scope.runId).normalize});this.kernel=new Kernel(file,registry);this.db=this.kernel.db;this.db.exec('CREATE TABLE IF NOT EXISTS host_state (id TEXT PRIMARY KEY,body TEXT NOT NULL)');this.state=this.db.prepare('SELECT body FROM host_state WHERE id=?').get('root');this.state=this.state?JSON.parse(this.state.body):{tasks:{},bindings:{},bindingHeads:{},transfers:{},delegations:{},commands:{}};}
 persist(){this.db.prepare('INSERT OR REPLACE INTO host_state VALUES(?,?)').run('root',JSON.stringify(this.state));}
 task(id){const t=this.state.tasks[id];if(!t)throw Error('NO_TASK');return t;}
 createTask(id,workspace){if(this.state.tasks[id])throw Error('TASK_EXISTS');this.state.tasks[id]={id,workspace,selection:null,selectionRevision:0,generation:0,state:'idle',history:[]};this.persist();return id;}
 boundKey(task,p){return hash([task.id,p.driverId,p.id,p.identity,p.root,task.workspace]);}
 command(id,body){const previous=this.state.commands[id];if(previous){if(previous.hash!==hash(body))throw Error('COMMAND_REUSED');return previous;}return null;}
 owner(taskId){const owner=this.runtimes.get(taskId),info=this.owners.get(owner);if(!info||info.closed||this.task(taskId).state!=='ready')throw Error('NO_LIVE_OWNER');return info;}
 checkHandle(owner){const info=this.owners.get(owner);if(!info||info.closed||this.runtimes.get(info.taskId)!==owner)throw Error('STALE_OR_FORGED_OWNER');return info;}
 openRequest(owner,request){const info=this.checkHandle(owner);this.directory.validate(info.token);requireCap(info.token.caps,'requests');return this.kernel.openRequest(info.handle,request);}
 async select(taskId,profileId,expectedRevision,commandId){
  const t=this.task(taskId),body={kind:'select',taskId,profileId,expectedRevision},prior=this.command(commandId,body);if(prior)return prior;
  if(t.selectionRevision!==expectedRevision)throw Error('SELECTION_CHANGED');if(!['idle','ready','failed'].includes(t.state))throw Error('TASK_BUSY_OR_UNCERTAIN');
  const token=this.directory.resolve(profileId);requireCap(token.caps,'turns');
  const baseKey=this.boundKey(t,token.profile);let key=this.state.bindingHeads[baseKey]??baseKey,binding=this.state.bindings[key],previousBindingId=null;
  if(binding&&token.caps.resume?.state==='unsupported'){previousBindingId=binding.id;binding=null;key=baseKey+'-replacement-'+randomUUID();}
  else if(binding)requireCap(token.caps,'resume');
  const missing=t.history.filter(x=>!binding?.covered.includes(x.id));
  if(missing.length&&!['supported'].includes(token.caps.historyInject?.state)&&token.caps.inlineHistory?.state!=='supported')throw Error('NO_HISTORY_PATH');
  t.state='switching';t.generation++;this.state.commands[commandId]={hash:hash(body),state:'dispatching'};this.persist();let runtime,owner;
  try{
   const old=this.runtimes.get(taskId);if(old){const i=this.checkHandle(old);await i.runtime.close();i.closed=true;this.kernel.detach(i.handle);this.runtimes.delete(taskId);}
   this.directory.validate(token);
   runtime=await token.driver.create(token.profile,{taskId,workspace:t.workspace,nativeId:binding?.nativeId??null});
   this.directory.validate(token);
   binding??={id:randomUUID(),key,baseKey,previousBindingId,taskId,profileId,driverId:token.profile.driverId,nativeId:runtime.nativeId,covered:[]};
   if(binding.nativeId!==runtime.nativeId)throw Error('RESUME_IDENTITY_CHANGED');
   this.state.bindings[key]=binding;
   const runId=randomUUID(),scope={taskId,bindingId:binding.id,runId,generation:t.generation};
   this.runtimeByRun.set(runId,runtime);const handle=this.kernel.attach(token.profile.driverId,scope);owner=Object.freeze({});
   this.owners.set(owner,{taskId,scope,handle,runtime,token,binding,closed:false});this.runtimes.set(taskId,owner);
   if(missing.length){
    const transfer={id:randomUUID(),bindingId:binding.id,nativeId:binding.nativeId,items:structuredClone(missing),source:'history-transfer',state:'dispatching'};this.state.transfers[transfer.id]=transfer;this.persist();
    let result;if(token.caps.historyInject?.state==='supported')result=await runtime.inject(transfer);else result={state:'not-supported'};
    if(result.state==='not-supported'&&token.caps.inlineHistory?.state==='supported')result=await runtime.inline(transfer);
    if(result.state!=='accepted'){transfer.state=result.state==='not-sent'?'not-sent':'unknown';t.state='recovery-required';this.state.commands[commandId].state=transfer.state;this.persist();return this.state.commands[commandId];}
    transfer.state='accepted';binding.covered.push(...missing.map(x=>x.id));
   }
   this.directory.validate(token);this.state.bindingHeads[baseKey]=key;t.selection=key;t.selectionRevision++;t.state='ready';this.state.commands[commandId].state='applied';this.persist();return this.state.commands[commandId];
  }catch(e){if(owner){const i=this.owners.get(owner);i.closed=true;this.kernel.detach(i.handle);this.runtimes.delete(taskId);}await runtime?.close();t.state='failed';this.state.commands[commandId].state='failed';this.state.commands[commandId].error=e.message;this.persist();throw e;}
 }
 async submit(taskId,text,commandId,source='ui-user'){
  if(source!=='ui-user')throw Error('USER_ENTRY_SOURCE');return this.dispatch(taskId,text,commandId,'ui-user');
 }
 async dispatch(taskId,text,commandId,source){
  const t=this.task(taskId),body={kind:'submit',taskId,text,source},prior=this.command(commandId,body);if(prior)return prior;
  const info=this.owner(taskId);this.directory.validate(info.token);t.state='running';const input={id:commandId,text,source};this.state.commands[commandId]={hash:hash(body),state:'dispatching'};t.history.push(input);this.persist();
  try{
   const reply=await info.runtime.start(input,raw=>this.kernel.ingest(info.handle,raw));
   if(reply.state!=='accepted'){t.state='recovery-required';this.state.commands[commandId].state='unknown';this.persist();return this.state.commands[commandId];}
   const item={id:reply.outputId,text:reply.text,source:'assistant',runId:info.scope.runId};t.history.push(item);info.binding.covered.push(input.id,item.id);t.state='ready';this.state.commands[commandId].state='applied';this.persist();return item;
  }catch(e){t.state='recovery-required';this.state.commands[commandId].state='unknown';this.persist();throw e;}
 }
 async delegate(owner,{target,text,key,workspace}){
  const info=this.checkHandle(owner);requireCap(info.token.caps,'hostTools');this.directory.validate(info.token);const targetToken=this.directory.resolve(target);requireCap(targetToken.caps,'turns');
  const request={target,text,workspace},identity=hash([info.scope.runId,key]);let d=this.state.delegations[identity];
  if(d){if(d.hash!==hash(request))throw Error('DELEGATION_KEY_REUSED');return d;}
  const childId=randomUUID();d={id:identity,parent:info.taskId,parentRun:info.scope.runId,childId,target,hash:hash(request),state:'created',delivered:false};this.state.delegations[identity]=d;this.createTask(childId,workspace);
  await this.select(childId,target,0,'select-'+identity);if(this.task(childId).state!=='ready'){d.state='unknown';this.persist();return d;}
  await this.dispatch(childId,text,'input-'+identity,'agent-delegation');d.state=this.task(childId).state==='ready'?'completed':'unknown';this.persist();return d;
 }
 async collect(owner,id){const info=this.checkHandle(owner),d=this.state.delegations[id];if(!d||d.parent!==info.taskId)throw Error('WRONG_PARENT');if(d.state!=='completed')throw Error('CHILD_NOT_COMPLETE');if(d.delivered)return;const t=this.task(info.taskId);if(t.state!=='ready')throw Error('PARENT_BUSY');const child=this.task(d.childId);const result=child.history.at(-1);await this.dispatch(t.id,result.text,'completion-'+id,'agent-result');d.delivered=true;this.persist();}
 async close(){for(const [task,owner] of this.runtimes){const i=this.owners.get(owner);await i.runtime.close();i.closed=true;this.kernel.detach(i.handle);}this.runtimes.clear();this.kernel.close();}
}
