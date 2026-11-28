import {createServer} from 'node:http';
export function fixture(){
  const requests=[],sockets=new Set();
  const server=createServer((req,res)=>{requests.push({at:Date.now(),url:req.url,method:req.method});res.writeHead(200,{'content-type':'text/html;charset=utf-8','cache-control':'no-store'});res.end('<!doctype html><meta charset="utf-8"><title>T145 own failure fixture</title><h1>T145 synthetic local page</h1>');});
  server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  return {server,requests,async close(){for(const s of sockets)s.destroy();await new Promise((ok,no)=>server.close(e=>e&&e.code!=='ERR_SERVER_NOT_RUNNING'?no(e):ok()));}};
}
function install(E,id,url,reason,proxy){
  return (async()=>{
    if(globalThis.__T145NavigationFault)throw Error('Previous own fault not restored');
    const w=E.webContents.fromId(id);if(!w||w.isDestroyed()||!w.debugger.isAttached())throw Error('Original exact Native page required');
    const f=globalThis.__T145NavigationFault={id,url,reason,events:[]};
    await w.session.setProxy({mode:'fixed_servers',proxyRules:proxy,proxyBypassRules:'<-loopback>'});await w.session.closeAllConnections();
    if(reason==='InternetDisconnected'){await w.debugger.sendCommand('Network.enable');await w.debugger.sendCommand('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
    else{f.listener=async(_event,method,params)=>{if(method!=='Fetch.requestPaused')return;const e={at:Date.now(),url:params.request.url,requestId:params.requestId,errorReason:reason};f.events.push(e);try{await w.debugger.sendCommand('Fetch.failRequest',{requestId:params.requestId,errorReason:reason});e.failed=true;}catch(error){f.error=String(error)}};w.debugger.on('message',f.listener);await w.debugger.sendCommand('Fetch.enable',{patterns:[{urlPattern:url,requestStage:'Request'}]});}
    return {id,url,reason,injected:true,scope:'Explicit owned Native CDP transport fault only. Actual Chromium load failure through unchanged Host/UI, no business state/DOM replacement. Existing T011 technique, visual A only; not normal-network behavior proof.'};
  })();
}
function restore(E,restoreProxy){return(async()=>{const f=globalThis.__T145NavigationFault;if(!f)return{alreadyAbsent:true};const w=E.webContents.fromId(f.id);if(!w||w.isDestroyed())throw Error('Own fault page unavailable');if(f.listener){await w.debugger.sendCommand('Fetch.disable');w.debugger.off('message',f.listener);}else if(f.reason==='InternetDisconnected')await w.debugger.sendCommand('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});if(restoreProxy){await w.session.setProxy({mode:'system'});await w.session.closeAllConnections();}const result={id:f.id,reason:f.reason,events:f.events,error:f.error??null,restored:true,proxyRestored:restoreProxy};delete globalThis.__T145NavigationFault;return result;})();}
export const faultBody=({id,url,reason,proxy})=>'return ('+install.toString()+')(E,'+[id,url,reason,proxy].map(JSON.stringify).join(',')+');';
export const restoreFaultBody=(proxy=true)=>'return ('+restore.toString()+')(E,'+JSON.stringify(proxy)+');';
export const cases=[{state:'B04-not-running',kind:'not-running',reason:'ConnectionRefused',error:'ERR_CONNECTION_REFUSED',host:'notrunning.localhost'},{state:'B04-refused',kind:'refused',reason:'ConnectionRefused',error:'ERR_CONNECTION_REFUSED',host:'refused.example.test'},{state:'B04-dns',kind:'dns',reason:'NameNotResolved',error:'ERR_NAME_NOT_RESOLVED',host:'dns.example.test'},{state:'B04-timeout',kind:'timeout',reason:'TimedOut',error:'ERR_TIMED_OUT',host:'timeout.example.test'},{state:'B04-reset',kind:'reset',reason:'ConnectionReset',error:'ERR_CONNECTION_RESET',host:'reset.example.test'},{state:'B04-other',kind:'other',reason:'Failed',error:'ERR_FAILED',host:'failed.example.test'},{state:'B04-offline',kind:'offline',reason:'InternetDisconnected',error:'ERR_INTERNET_DISCONNECTED',host:'offline.example.test'}];
