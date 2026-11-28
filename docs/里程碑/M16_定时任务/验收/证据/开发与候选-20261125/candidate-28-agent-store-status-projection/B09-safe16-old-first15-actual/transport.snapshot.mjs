// Exact original T145 transport fixture, applied only to a new isolated owned
// native page. No real host, DNS, system network configuration, or app state edit.
import assert from 'node:assert/strict';
import {cases,faultBody,restoreFaultBody} from './fixtures/network.mjs';
export {cases};
export async function armFault(d,p,c,combo){
 assert(cases.some(x=>JSON.stringify(x)===JSON.stringify(c)));assert(/^(light|dark)-rw(480|900)-win1920x1080$/.test(combo));
 const url='http://'+c.host+'/case?combo='+combo;
 assert(p.url==='http://127.0.0.1:55011/page?combo='+combo);
 const body=faultBody({id:p.wc,url,reason:c.reason,proxy:'http=127.0.0.1:55011'});
 const actual=await d.observeMain(async(E,id,prior,url,data,body)=>{
   const w=E.webContents.fromId(id);
   if(!w||w.isDestroyed()||w.getURL()!==prior||!w.debugger.isAttached()||!w.session.storagePath?.startsWith(data+'/Partitions/wy-browser-'))throw Error('Exact isolated browser page/session required');
   const peers=E.webContents.getAllWebContents().filter(v=>!v.isDestroyed()&&v.session===w.session).map(v=>v.id);if(peers.length!==1||peers[0]!==id)throw Error('Private session must have one own page');
   if(globalThis.__m16Safe16Fault)throw Error('Previous fault not restored');
   const r=globalThis.__m16Safe16Fault={id,url,prior,data,w,session:w.session,events:[],listeners:[]};
   const add=(name,fn)=>{w.on(name,fn);r.listeners.push([name,fn]);};
   add('did-start-navigation',(_e,href,_inPage,main)=>{if(main)r.events.push({kind:'did-start-navigation',url:href,at:Date.now()});});
   add('did-fail-load',(_e,code,error,href,main)=>{if(main)r.events.push({kind:'did-fail-load',url:href,error,code,at:Date.now()});});
   add('did-finish-load',()=>r.events.push({kind:'did-finish-load',url:w.getURL(),at:Date.now()}));
   const injected=await new Function('E',body)(E);
   return {injected,peers,storage:w.session.storagePath,actualProxy:await w.session.resolveProxy(url),boundary:'Original owned transport-only fault, local fixed proxy and reserved synthetic .test/.localhost host'};
 },p.wc,p.url,url,d.userData,body);
 assert(actual.injected.injected&&actual.actualProxy.includes('127.0.0.1:55011'));
 return {url,c,actual};
}
export async function faultObservation(d,p){
 return d.observeMain((E,id)=>{const r=globalThis.__m16Safe16Fault,f=globalThis.__T145NavigationFault,w=E.webContents.fromId(id);if(!r||r.id!==id||!w||w!==r.w)throw Error('Exact own fault observation required');return {events:r.events,transportEvents:f?.events??[],error:f?.error??null,wc:w.id,nativeUrl:w.getURL(),title:w.getTitle(),loading:w.isLoading()};},p.wc);
}
export async function releaseTransport(d,p,fault){
 const result=await d.observeMain(async(E,id,body)=>{const r=globalThis.__m16Safe16Fault;if(!r||r.id!==id||r.w!==E.webContents.fromId(id))throw Error('Wrong isolated fault page');return await new Function('E',body)(E);},p.wc,restoreFaultBody(false));
 assert(result.restored&&result.error===null&&result.id===p.wc);
 if(fault.c.reason!=='InternetDisconnected')assert(result.events.some(e=>e.url===fault.url&&e.errorReason===fault.c.reason&&e.failed===true));
 return result;
}
export async function finishFault(d,p,{safeRecovery=false}={}){
 const r=await d.observeMain(async(E,id,body,recovered)=>{
  const x=globalThis.__m16Safe16Fault;if(!x)return {absent:true};if(x.id!==id||x.w!==E.webContents.fromId(id)||!x.session.storagePath?.startsWith(x.data+'/Partitions/wy-browser-'))throw Error('Exact own transport cleanup required');
  if(globalThis.__T145NavigationFault)await new Function('E',body)(E);
  // Only restore default proxy after actual explicit local recovery. On failure,
  // leave the own partition local-only until the normal private App exits.
  if(recovered){if(x.w.getURL()!==x.prior||x.w.isLoading())throw Error('Actual committed local page not recovered');await x.session.setProxy({mode:'system'});await x.session.closeAllConnections();}
  for(const [name,fn]of x.listeners)x.w.off(name,fn);
  const result={wc:id,events:x.events,transportRemoved:!globalThis.__T145NavigationFault,proxyRestored:recovered,source:x.prior,privateOnlyUntilQuit:!recovered};delete globalThis.__m16Safe16Fault;return result;
 },p.wc,restoreFaultBody(false),safeRecovery);
 assert(r.absent||r.transportRemoved);return r;
}
