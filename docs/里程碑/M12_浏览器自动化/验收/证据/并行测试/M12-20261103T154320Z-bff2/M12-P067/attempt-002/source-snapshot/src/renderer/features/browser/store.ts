import type {BrowserWorkspaceState} from '@shared/browser-workspace';
import {rpc} from '@renderer/lib/ipc';
import {navigation} from '@renderer/core/navigation';
import {tasksStore} from '@renderer/core/tasks-store';
export class BrowserWorkspaceStore {
  private value:{state:BrowserWorkspaceState|null;error:string}={state:null,error:''};
  private readonly listeners=new Set<()=>void>();
  private request=0;
  constructor(readonly taskId:string){}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  snapshot=()=>this.value;
  private emit(){for(const fn of this.listeners)fn();}
  async refresh(){const request=++this.request;try{const state=await rpc.browser.snapshot({taskId:this.taskId});if(request===this.request){this.value={state,error:''};this.emit();}}catch(error){if(request===this.request){this.value={...this.value,error:error instanceof Error?error.message:String(error)};this.emit();}}}
  async run(action:()=>Promise<unknown>){try{await action();await this.refresh();}catch(error){this.value={...this.value,error:error instanceof Error?error.message:String(error)};this.emit();}}
  create=()=>this.run(()=>rpc.browser.create({taskId:this.taskId}));
  select=(tabId:string|null)=>this.run(()=>rpc.browser.select({taskId:this.taskId,tabId}));
  close=(tabId:string)=>this.run(()=>rpc.browser.close({taskId:this.taskId,tabId}));
  reopen=()=>this.run(()=>rpc.browser.reopen({taskId:this.taskId}));
}
const stores=new Map<string,BrowserWorkspaceStore>();
export function browserWorkspaceFor(taskId:string){let store=stores.get(taskId);if(!store){store=new BrowserWorkspaceStore(taskId);stores.set(taskId,store);}return store;}
export function openNewBrowserTab(taskId:string){
  if(navigation.currentViewId!=='task'||tasksStore.current?.id!==taskId||!tasksStore.current.projectId)return;
  if(!navigation.filePanelOpen)navigation.toggleFilePanel();void browserWorkspaceFor(taskId).create();
}
