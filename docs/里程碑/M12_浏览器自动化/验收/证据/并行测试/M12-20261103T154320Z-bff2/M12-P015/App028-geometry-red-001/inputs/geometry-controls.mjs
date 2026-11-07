import assert from'node:assert/strict';
import{EventEmitter}from'node:events';
import{installNativeGeometry,readNativeGeometry,restoreNativeGeometry}from'./geometry-observer.mjs';
// Pure EventEmitter/object controls only; no Electron import, spawn or product body.
export function geometryDelegateControls(){
  const page=new EventEmitter(),session=new EventEmitter(),calls=[],marker=Error('control-original-error');let result;
  Object.assign(page,{id:55,session,isDestroyed:()=>false,getURL:()=> 'http://fixture.invalid/page',isLoading:()=>false});
  const original=function(...args){calls.push({receiver:this,args});if(result===marker)throw marker;this.bounds={...args[0]};return result;};
  const view={webContents:page,bounds:{x:1,y:2,width:624,height:743},getBounds(){return{...this.bounds}},setBounds:original};
  const parent={id:1,contentView:{children:[view]},webContents:{getURL:()=> 'file:///owned-main'}};
  const E={webContents:{fromId:id=>id===55?page:null},BaseWindow:{getAllWindows:()=>[parent]}};
  const invoke=body=>new Function('E',body)(E);let restored;
  try{
    assert.equal(invoke(installNativeGeometry(55,page.getURL())).installed,true);
    for(const value of[undefined,true,false,{identity:'original-object'}]){result=value;const rectangle={x:0,y:0,width:624,height:741};assert.equal(view.setBounds(rectangle),value);assert.equal(calls.at(-1).receiver,view);assert.equal(calls.at(-1).args[0],rectangle);}
    result=marker;assert.throws(()=>view.setBounds({x:0,y:0,width:1,height:1}),e=>e===marker);
    const before=invoke(readNativeGeometry).events.length;session.emit('will-download',{},null,{id:56});assert.equal(invoke(readNativeGeometry).events.length,before);
    session.emit('will-download',{}, {getFilename:()=> 'control.csv',getURL:()=> 'http://fixture.invalid/normal',getSavePath:()=> '/owned/control.csv'},page);
    assert.equal(invoke(readNativeGeometry).events.at(-1).type,'will-download');
  }finally{restored=invoke(restoreNativeGeometry);}
  assert(restored.restored&&restored.originalReferenceOwned&&restored.listenersRemoved);assert.equal(view.setBounds,original);assert.equal(session.listenerCount('will-download'),0);assert.equal(page.eventNames().length,0);assert.equal(globalThis.__T015GeometryNative,undefined);
  return{fakeOnly:true,originalThisAndArgumentIdentity:true,returnVariants:4,originalErrorIdentity:true,foreignContentsIgnored:true,originalReferenceAndListenersRestored:true};
}
