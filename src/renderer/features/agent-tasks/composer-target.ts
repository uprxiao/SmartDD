// A mounted composer is an editable draft sink, never a PTY or an authorization receipt.
import type {FileDocument} from '@shared/files';
import {makeAutoObservable,observable} from 'mobx';
export interface AgentComposerTarget {taskId:string;projectId:string|null;insert(text:string):void;focus():void;attachFile?(file:FileDocument,baseHash:string,signal:AbortSignal):Promise<void>}
class ComposerTargets {
 current:AgentComposerTarget|null=null;
 private listeners=new Set<()=>void>();
 constructor(){makeAutoObservable<this,'listeners'>(this,{listeners:false,current:observable.ref});}
 register(target:AgentComposerTarget){this.current=target;this.changed();return()=>{if(this.current===target){this.current=null;this.changed();}};}
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private changed(){for(const listener of this.listeners)listener();}
}
export const agentComposerTargets=new ComposerTargets();
