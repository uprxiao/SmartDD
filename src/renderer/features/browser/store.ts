import type {BrowserWorkspaceState} from '@shared/browser-workspace';
import {rpc} from '@renderer/lib/ipc';
import {navigation} from '@renderer/core/navigation';
import {panelsFor} from '@renderer/features/agent-tasks/workspace-panels-store';
import {agentTasksStore} from '@renderer/core/agent-tasks-store';
import {authorizeBrowserPresentation,type BrowserPresentationEvent} from './open-presentation';
export class BrowserWorkspaceStore {
  private value:{state:BrowserWorkspaceState|null;error:string}={state:null,error:''};
  private readonly listeners=new Set<()=>void>();
  private request=0;
  private openingTabs=0;
  constructor(readonly taskId:string){}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  snapshot=()=>this.value;
  private emit(){for(const fn of this.listeners)fn();}
  async refresh(){const request=++this.request;try{const state=await rpc.browser.snapshot({taskId:this.taskId});if(request===this.request){this.value={state,error:''};this.emit();}}catch(error){if(request===this.request){this.value={...this.value,error:error instanceof Error?error.message:String(error)};this.emit();}}}
  async run(action:()=>Promise<unknown>){try{await action();await this.refresh();}catch(error){this.value={...this.value,error:error instanceof Error?error.message:String(error)};this.emit();}}
  get openingTab(){return this.openingTabs>0;}
  private async openTab(action:()=>Promise<unknown>){
    this.openingTabs++;
    try{await action();}
    finally{
      this.openingTabs--;
      this.value={...this.value};
      this.emit();
    }
  }
  create=()=>this.openTab(()=>this.run(()=>rpc.browser.create({taskId:this.taskId})));
  createWithAddress=(address:string)=>this.openTab(async()=>{
    const request=++this.request;
    const state=await rpc.browser.create({taskId:this.taskId,address});
    if(!state.activeId)throw new Error('网页标签未创建');
    if(request===this.request)this.value={state,error:''};
  });
  select=(tabId:string|null)=>this.run(()=>rpc.browser.select({taskId:this.taskId,tabId}));
  close=(tabId:string)=>this.run(()=>rpc.browser.close({taskId:this.taskId,tabId}));
  reopen=()=>this.openTab(()=>this.run(()=>rpc.browser.reopen({taskId:this.taskId})));
}
const stores=new Map<string,BrowserWorkspaceStore>();
export function browserWorkspaceFor(taskId:string){let store=stores.get(taskId);if(!store){store=new BrowserWorkspaceStore(taskId);stores.set(taskId,store);}return store;}
function isCurrentBrowserTask(taskId:string){
  return navigation.currentViewId==='agentTask'&&navigation.currentAgentTaskId===taskId&&!navigation.agentTaskReadOnly;
}
export function openNewBrowserTab(taskId:string){
  if(!isCurrentBrowserTask(taskId)||!agentTasksStore.tasks.find(task=>task.taskId===taskId)?.projectId)return;
  panelsFor({kind:'task',taskId}).open('browser');
  void browserWorkspaceFor(taskId).create();
}
export async function openBrowserLink(taskId:string,address:string){
  await browserWorkspaceFor(taskId).createWithAddress(address);
  if(isCurrentBrowserTask(taskId))panelsFor({kind:'task',taskId}).open('browser');
}
export async function revealBrowserTab(taskId: string, tabId: string) {
  if (!isCurrentBrowserTask(taskId)) return;
  await rpc.browser.select({ taskId, tabId });
  if (!isCurrentBrowserTask(taskId)) return;
  panelsFor({ kind: 'task', taskId }).open('browser');
  await browserWorkspaceFor(taskId).refresh();
}
export async function showBrowserPresentation(event:BrowserPresentationEvent){
  if(!authorizeBrowserPresentation(event))return;
  await rpc.browser.select({taskId:event.taskId,tabId:event.pageId});
  if(!authorizeBrowserPresentation(event))return;
  panelsFor({kind:'task',taskId:event.taskId}).open('browser',true);
  await browserWorkspaceFor(event.taskId).refresh();
}
