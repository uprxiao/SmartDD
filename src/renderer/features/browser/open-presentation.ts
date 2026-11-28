import {reaction} from 'mobx';
import {navigation} from '@renderer/core/navigation';

export interface BrowserPresentationEvent {
  taskId:string;
  pageId:string;
  clientInputId:string;
  operationId:string;
}

interface Intent {
  taskId:string;
  revision:number;
  awaitingTaskView:boolean;
  pending?:BrowserPresentationEvent;
}

const intentions=new Map<string,Intent>();
let revision=0;

export function browserViewRevision(){return revision;}
export function invalidateBrowserPresentation(){revision++;}

export function observeBrowserPresentationView(){
  return reaction(
    ()=>[navigation.currentViewId,navigation.currentAgentTaskId,navigation.filePanelOpen,navigation.agentTaskReadOnly],
    invalidateBrowserPresentation,
  );
}

export function rememberBrowserPresentation(taskId:string,clientInputId:string,originalRevision=revision,awaitingTaskView=false){
  if(intentions.has(clientInputId))return;
  intentions.set(clientInputId,{taskId,revision:originalRevision,awaitingTaskView});
  if(intentions.size>128)intentions.delete(intentions.keys().next().value!);
}

export function enterBrowserPresentationTask(taskId:string,clientInputId:string,enter:()=>void){
  const intent=intentions.get(clientInputId);
  const transfer=intent?.taskId===taskId&&intent.awaitingTaskView&&intent.revision===revision;
  enter();
  if(!transfer||!intent)return;
  intent.awaitingTaskView=false;
  intent.revision=revision;
  const pending=intent.pending;
  delete intent.pending;
  return pending;
}

export function authorizeBrowserPresentation(event:BrowserPresentationEvent):boolean{
  const intent=intentions.get(event.clientInputId);
  if(!intent||intent.taskId!==event.taskId||intent.revision!==revision)return false;
  if(intent.awaitingTaskView){
    intent.pending=event;
    return false;
  }
  return navigation.currentViewId==='agentTask'&&navigation.currentAgentTaskId===event.taskId&&!navigation.agentTaskReadOnly;
}

/** A synchronous host-directed reveal may open the right panel itself. Only that
 * known local action rebases the same intent; subsequent human actions still
 * invalidate it and late acknowledgements cannot steal a different view. */
export function activateBrowserPresentation(event:BrowserPresentationEvent,activate:()=>void):boolean{
  if(!authorizeBrowserPresentation(event))return false;
  const intent=intentions.get(event.clientInputId)!;
  activate();
  if(intentions.get(event.clientInputId)!==intent||navigation.currentViewId!=='agentTask'||navigation.currentAgentTaskId!==event.taskId||navigation.agentTaskReadOnly)return false;
  intent.revision=revision;
  return authorizeBrowserPresentation(event);
}
