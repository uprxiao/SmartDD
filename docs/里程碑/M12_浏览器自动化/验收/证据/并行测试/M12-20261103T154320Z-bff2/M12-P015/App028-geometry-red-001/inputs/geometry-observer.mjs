// Temporary read-only observers. The exact native view's setBounds delegates
// the original this/arguments/return/throw; all listeners/references restore.
function installNative(E,contentsId,expectedURL){
  if(globalThis.__T015GeometryNative)throw Error('Geometry observer already installed');
  const page=E.webContents.fromId(contentsId);
  if(!page||page.isDestroyed()||page.getURL()!==expectedURL)throw Error('Exact own geometry page required');
  let view;
  for(const parent of E.BaseWindow.getAllWindows()){
    const candidate=parent.contentView.children.find(v=>v.webContents?.id===contentsId);
    if(candidate){if(view&&view!==candidate)throw Error('Duplicate geometry view');view=candidate;}
  }
  if(!view)throw Error('Mounted exact view required');
  const state={page,view,original:view.setBounds,events:[],dropped:0,listeners:[]};
  const sample=(type,extra={})=>{
    if(state.events.length>=256){state.dropped++;return;}
    const row={at:Date.now(),type,...extra};
    try{row.native={contentsId:page.id,url:page.getURL(),loading:page.isLoading(),viewBounds:view.getBounds(),parents:E.BaseWindow.getAllWindows().filter(p=>p.contentView.children.includes(view)).map(p=>({id:p.id,kind:p.webContents?.getURL().startsWith('file:')?'main':'park'}))};}
    catch(error){row.observationError={name:error.name,message:error.message,stack:error.stack};}
    state.events.push(row);
  };
  state.wrapper=function(...args){
    sample('placement-before',{args});
    try{const value=Reflect.apply(state.original,this,args);sample('placement-after',{args,returnType:typeof value});return value;}
    catch(error){sample('placement-original-throw',{name:error.name,message:error.message,stack:error.stack});throw error;}
  };
  view.setBounds=state.wrapper;
  if(view.setBounds!==state.wrapper)throw Error('Exact view observer installation failed');
  globalThis.__T015GeometryNative=state;
  for(const type of['did-start-navigation','did-start-loading','did-stop-loading','did-finish-load']){
    const listener=(...args)=>sample(type,type==='did-start-navigation'?{navigationURL:args[1],mainFrame:args[3]}:{});
    page.on(type,listener);state.listeners.push([type,listener]);
  }
  state.download=(_event,item,contents)=>{if(contents.id===page.id)sample('will-download',{filename:item.getFilename(),url:item.getURL(),savePath:item.getSavePath()});};
  page.session.on('will-download',state.download);
  sample('observer-installed');
  return{installed:true,contentsId,pageURL:expectedURL,realSetBoundsDelegation:true};
}
function readNative(){const s=globalThis.__T015GeometryNative;if(!s)throw Error('Geometry observer absent');return{events:s.events,dropped:s.dropped};}
function restoreNative(){const s=globalThis.__T015GeometryNative;if(!s)return{notInstalled:true};for(const[type,listener]of s.listeners)s.page.off(type,listener);s.page.session.off('will-download',s.download);const exact=s.view.setBounds===s.wrapper;if(exact)s.view.setBounds=s.original;const restored=s.view.setBounds===s.original;delete globalThis.__T015GeometryNative;return{restored,originalReferenceOwned:exact,listenersRemoved:true};}
export const installNativeGeometry=(id,url)=>'return ('+installNative.toString()+')(E,'+JSON.stringify(id)+','+JSON.stringify(url)+');';
export const readNativeGeometry='return ('+readNative.toString()+')();';
export const restoreNativeGeometry='return ('+restoreNative.toString()+')();';

function installDOM(expected){
  if(location.href!==expected.url||performance.timeOrigin!==expected.timeOrigin||globalThis.__T015GeometryDOM)throw Error('Exact fresh own main document required');
  const root=document.querySelector('.bw-workspace');if(!root)throw Error('Browser workspace absent');
  const state={events:[],dropped:0,expected,last:''};
  const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};};
  const sample=reason=>{
    const progress=root.querySelector('.bw-progress'),page=root.querySelector('.bw-page'),style=progress?getComputedStyle(progress):null;
    const row={at:Date.now(),reason,viewport:rect(page),workspace:rect(root),progress:rect(progress),progressVisible:!!progress&&style.display!=='none'&&style.visibility!=='hidden',navigationLoading:!!root.querySelector('button[aria-label="停止加载"]'),snapshotVisible:!!root.querySelector('.bw-page-snapshot'),downloadsVisible:!!root.querySelector('[role=region][aria-label=下载]')};
    const signature=JSON.stringify({...row,at:0,reason:''});
    if(signature!==state.last){state.last=signature;if(state.events.length<256)state.events.push(row);else state.dropped++;}
    return row;
  };
  state.sample=sample;state.observer=new MutationObserver(()=>sample('mutation'));
  state.observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-label']});
  globalThis.__T015GeometryDOM=state;sample('observer-installed');return{installed:true,timeOrigin:expected.timeOrigin};
}
function readDOM(){const s=globalThis.__T015GeometryDOM;if(!s||location.href!==s.expected.url||performance.timeOrigin!==s.expected.timeOrigin)throw Error('Geometry document changed');return{current:s.sample('read'),events:s.events,dropped:s.dropped};}
function restoreDOM(){const s=globalThis.__T015GeometryDOM;if(!s)return{notInstalled:true};s.observer.disconnect();delete globalThis.__T015GeometryDOM;return{restored:true};}
export const installDOMGeometry=expected=>'('+installDOM.toString()+')('+JSON.stringify(expected)+')';
export const readDOMGeometry='('+readDOM.toString()+')()';
export const restoreDOMGeometry='('+restoreDOM.toString()+')()';
