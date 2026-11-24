import {makeAutoObservable} from 'mobx';
import type {FileScope} from '@shared/files';
import {navigation} from '@renderer/core/navigation';
import {invalidateBrowserPresentation} from '@renderer/features/browser/open-presentation';
export interface MessageAttachmentSelection { turnId: string; index: number; name: string }
export type AgentPanel='files'|'browser'|'terminal'|'diff'|'attachment';
class Panels {
  tabs:AgentPanel[]=['files'];
  active:AgentPanel='files';
  maximized=false;
  drawer=false;
  lineage=false;
  diffTurn:string|null=null;
  attachment:MessageAttachmentSelection|null=null;
  constructor(){makeAutoObservable(this);}
  setLineage(open:boolean){this.lineage=open;}
  showAttachment(attachment:MessageAttachmentSelection){
    this.attachment=attachment;
    this.open('attachment');
  }
  open(id:AgentPanel,automatic=false){if(!automatic)invalidateBrowserPresentation();if(!this.tabs.includes(id))this.tabs.push(id);this.active=id;if(id==='terminal')this.drawer=false;if(!navigation.filePanelOpen)navigation.toggleFilePanel();}
  close(id:AgentPanel){
    invalidateBrowserPresentation();
    this.tabs=this.tabs.filter(t=>t!==id);
    if(id==='attachment')this.attachment=null;
    if(this.active===id)this.active=this.tabs.at(-1)??'files';
  }
  terminalDrawer(){this.setDrawer(!this.drawer);}
  setDrawer(open:boolean){this.drawer=open;if(open)this.maximized=false;if(this.drawer&&this.active==='terminal'){invalidateBrowserPresentation();this.active=this.tabs.find(t=>t!=='terminal')??'files';if(!this.tabs.includes(this.active))this.tabs.push(this.active);}}
}
const panels=new Map<string,Panels>();
export const panelKey=(scope:FileScope)=>scope.kind+':'+(scope.kind==='task'?scope.taskId:scope.projectId);
export function panelsFor(scope:FileScope){const key=panelKey(scope);let value=panels.get(key);if(!value){value=new Panels();panels.set(key,value);}return value;}
class HomeWorkspace {projectId:string|null=null;dirId:string|null=null;cwd:string|null=null;constructor(){makeAutoObservable(this);}set(projectId:string|null,dirId:string|null,cwd:string|null){this.projectId=projectId;this.dirId=dirId;this.cwd=cwd;}}
export const homeWorkspace=new HomeWorkspace();
