import {rpc} from '@renderer/lib/ipc';
import type {BrowserAccessMode} from '@shared/browser-access';

type AccessState=Awaited<ReturnType<typeof rpc.browser.accessState>>;
/** Only main-process snapshots confer authority. This store is transient UI. */
export class BrowserAccessStore {
  private value:{state:AccessState;grantsOpen:boolean;surface:boolean;busy:boolean;error:string}={state:{requests:[],grants:[]},grantsOpen:false,surface:false,busy:false,error:''};
  private readonly listeners=new Set<()=>void>();
  private readonly surfaces=new Set<object>();
  private generation=0;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  snapshot=()=>this.value;
  private update(patch:Partial<typeof this.value>){this.value={...this.value,...patch};for(const listener of this.listeners)listener();}
  async refresh(){const generation=++this.generation;try{const state=await rpc.browser.accessState();if(generation===this.generation)this.update({state,error:''});}catch(error){if(generation===this.generation)this.update({error:error instanceof Error?error.message:String(error)});}}
  mountSurface(){const token={};this.surfaces.add(token);if(!this.value.surface)this.update({surface:true});return()=>{this.surfaces.delete(token);if(!this.surfaces.size)this.update({surface:false});};}
  openGrants=()=>{this.update({grantsOpen:true});void this.refresh();};
  closeGrants=()=>this.update({grantsOpen:false,error:''});
  private async action(work:()=>Promise<unknown>){if(this.value.busy)return;this.update({busy:true,error:''});try{await work();await this.refresh();}catch(error){await this.refresh();this.update({error:error instanceof Error?error.message:String(error)});}finally{this.update({busy:false});}}
  decide=(id:string,allow:boolean,mode?:BrowserAccessMode)=>this.action(()=>rpc.browser.respondAccess({id,allow,...(mode?{mode}:{})}));
  revoke=(id:string)=>this.action(()=>rpc.browser.revokeAccess({id}));
}
export const browserAccess=new BrowserAccessStore();
