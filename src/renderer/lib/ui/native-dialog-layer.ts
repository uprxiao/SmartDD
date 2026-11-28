import {rpc} from '@renderer/lib/ipc';

type BrowserTarget={taskId:string;tabId:string};
type DialogLease={owner:string;target:BrowserTarget|null;image:string|null};
type LayerSnapshot={blocked:boolean;leases:readonly DialogLease[]};
const leases=new Map<string,DialogLease>();
const listeners=new Set<()=>void>();
let state:LayerSnapshot={blocked:false,leases:[]};
function publish(){state={blocked:leases.size>0,leases:[...leases.values()]};for(const listener of listeners)listener();}
export const nativeDialogLayer={
  snapshot:()=>state,
  subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
};

function currentBrowser():BrowserTarget|null {
  // BrowserView is mounted only for the selected browser surface. The native
  // root blocker is still required if a different surface appears mid-dialog.
  const elements=[...document.querySelectorAll<HTMLElement>('.bw-workspace[data-browser-task][data-browser-page]')];
  if(elements.length!==1)return null;
  const {browserTask,browserPage}=elements[0].dataset;
  return browserTask&&browserPage?{taskId:browserTask,tabId:browserPage}:null;
}
const attempt=<T>(fn:()=>Promise<T>)=>Promise.resolve().then(fn);

/** Independent lease for the lifetime of an actual dialog portal, not its
 * parent component. A parked browser remains behind the trusted shell even
 * if another layout/presentation arrives while this dialog is open. */
export function holdNativeDialog(){
  const owner=crypto.randomUUID(),target=currentBrowser();
  const lease:DialogLease={owner,target,image:null};
  let released=false;
  // Use the existing trusted-root block, independent of per-browser preview
  // capture. A slow/failed screenshot must never delay usable modal controls.
  const ready=attempt(()=>rpc.nativeSurface.overlay({owner,open:true}));
  if(target)void attempt(()=>rpc.browser.overlay({...target,owner,instance:owner,open:true})).then(image=>{
    if(released||leases.get(owner)!==lease)return;
    leases.set(owner,{...lease,image});publish();
  }).catch(()=>{});
  leases.set(owner,lease);publish();
  return {ready,release:()=>{
    if(released)return;released=true;
    // Cancel this exact capture even when its screenshot has not settled.
    // Never release another dialog's lease or re-present the native slot
    // before the matching open request has settled.
    void (async()=>{
      if(target)await attempt(()=>rpc.browser.overlay({...target,owner,instance:owner,open:false})).catch(()=>{});
      await ready.catch(()=>{});
      await attempt(()=>rpc.nativeSurface.overlay({owner,open:false})).catch(()=>{});
      leases.delete(owner);publish();
    })();
  }};
}
