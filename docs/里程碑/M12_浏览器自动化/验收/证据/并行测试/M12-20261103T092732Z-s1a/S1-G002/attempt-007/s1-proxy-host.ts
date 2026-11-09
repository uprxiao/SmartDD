// Integration fixture: real production CDP proxy/helper; synthetic pages, no application/UI acceptance claim.
import { app, BrowserWindow, WebContentsView } from 'electron';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { BrowserCdpProxy } from '../../src/main/core/browser/cdp-proxy';
import { BrowserHelper } from '../../src/main/core/browser/agent-browser';
import { MacProcessIdentityReader } from '../../src/main/core/applications/process-identity';

for(const event of ['uncaughtException','unhandledRejection'] as const)process.on(event,error=>{process.send?.({fatal:String(error instanceof Error?error.stack:error)});console.error(error);app.exit(1);});

let host: BrowserWindow, view: WebContentsView, proxy: BrowserCdpProxy, helper: BrowserHelper;
const methods: string[] = [];
const server = createServer((_req,res) => {
  res.setHeader('content-type','text/html; charset=utf-8');
  res.end('<title>[I] M12 S1 proxy</title><h1>S1 synthetic page</h1><button id="action">Action</button><input aria-label="Input" id="field"><p id="out"></p><script>window.hits=[];document.addEventListener("click",e=>{hits.push(e.target.id);document.getElementById("out").textContent=hits.join(",")},true)</script>');
});
app.whenReady().then(async () => {
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture bind');
  host = new BrowserWindow({ width:1000,height:700,show:false,focusable:false,skipTaskbar:true,title:'[I] M12 S1 integration',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false} });
  await host.loadURL('data:text/html,<title>[I] M12 S1 integration host</title>');
  view = new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'persist:s1-fixture',backgroundThrottling:false}});
  view.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  host.contentView.addChildView(view); view.setBounds({x:0,y:0,width:1000,height:700}); host.showInactive();
  await view.webContents.loadURL('about:blank');
  const original = view.webContents.debugger.sendCommand.bind(view.webContents.debugger);
  view.webContents.debugger.sendCommand = (method,params,sessionId) => { methods.push(method); process.send?.({stage:'cdp',method}); return sessionId ? original(method,params,sessionId) : original(method,params); };
  proxy = new BrowserCdpProxy(view.webContents, traffic => process.send?.({stage:'proxy',traffic})); await proxy.start();
  await view.webContents.loadURL(`http://127.0.0.1:${address.port}/`);
  const source = JSON.parse(readFileSync(join(process.env.M12_HELPER_ROOT!,'SOURCE.json'),'utf8'));
  helper = new BrowserHelper({executable:join(process.env.M12_HELPER_ROOT!,'arm64/agent-browser'),sha256:source.files.find((f:{arch:string})=>f.arch==='arm64').sha256,home:join(app.getPath('userData'),'helper'),session:'m12-s1-proxy',endpoint:proxy.endpoint,processes:new MacProcessIdentityReader(join(process.env.M12_HELPER_ROOT!,'../native/willyou-process-identity'))},()=>{});
  process.send?.({ready:true,pid:process.pid,versions:process.versions,boundary:'I: real production proxy and fixed helper, synthetic page, no global debug port, not packaged App',endpoint:proxy.endpoint});
}).catch(error => { process.send?.({fatal:String(error.stack??error)}); app.quit(); });

process.on('message',async (message:{id:number;command:string;args?:string[]}) => {
  try {
    let value:unknown;
    if(message.command==='helper') value=await helper.command(message.args!,{timeout:10000});
    else if(message.command==='observe') value={state:(await proxy.send<{result:{value:unknown}}>('Runtime.evaluate',{expression:'({hits:window.hits,value:document.getElementById("field").value})',returnByValue:true})).result.value,methods};
    else if(message.command==='close') { await helper.close(); await proxy.stop(); view.webContents.close(); host.destroy(); await new Promise<void>(resolve=>server.close(()=>resolve())); value={closed:true}; }
    else throw Error('Unknown fixture action');
    process.send?.({id:message.id,value}); if(message.command==='close') app.quit();
  } catch(error) { process.send?.({id:message.id,error:String(error instanceof Error?error.stack:error)}); }
});
app.on('window-all-closed',()=>app.quit());
