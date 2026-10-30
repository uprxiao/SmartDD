const {app,BrowserWindow,session,ipcMain}=require('electron');
const {createServer}=require('node:net'),{createSocket}=require('node:dgram'),{writeFileSync}=require('node:fs');
const path=require('node:path');const base=process.env.SMARTDD_MCP_NETWORK_BASE;if(!base)throw Error('isolated output directory required');app.setPath('userData',path.join(base,'user-data'));
const report={startedAt:new Date().toISOString(),versions:process.versions,cases:[]};
app.on('window-all-closed',()=>{});
const timeout=setTimeout(()=>{report.timeout=true;finish(2)},30000);let finishing=false;
async function finish(code){if(finishing)return;finishing=true;clearTimeout(timeout);writeFileSync(path.join(base,'network-result.json'),JSON.stringify(report,null,2)+'\n');for(const win of BrowserWindow.getAllWindows())win.destroy();app.exit(code)}
process.on('uncaughtException',error=>{report.error=String(error.stack);finish(1)});process.on('unhandledRejection',error=>{report.error=String(error?.stack||error);finish(1)});
async function run(guarded){
 const counts={stunUdp:0,turnTcp:0,turnTls:0},udp=createSocket('udp4');udp.on('message',()=>counts.stunUdp++);await new Promise(r=>udp.bind(0,'127.0.0.1',r));
 const tcp=createServer(socket=>{counts.turnTcp++;socket.destroy()}),tls=createServer(socket=>{counts.turnTls++;socket.destroy()});
 await Promise.all([new Promise(r=>tcp.listen(0,'127.0.0.1',r)),new Promise(r=>tls.listen(0,'127.0.0.1',r))]);
 const ports={udp:udp.address().port,tcp:tcp.address().port,tls:tls.address().port};
 const isolated=session.fromPartition(`willyou-mcp-probe-${guarded}-${Date.now()}`,{cache:false});let proxy=null;
 if(guarded){await isolated.setProxy({mode:'fixed_servers',proxyRules:'http=127.0.0.1:0;https=127.0.0.1:0;socks=127.0.0.1:0',proxyBypassRules:'<-loopback>'});proxy={http:await isolated.resolveProxy('http://127.0.0.1:12345'),https:await isolated.resolveProxy('https://127.0.0.1:12345')};}
 const win=new BrowserWindow({show:false,webPreferences:{session:isolated,sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,webSecurity:true,preload:path.join(__dirname,'network-preload.cjs')}});
 if(guarded)win.webContents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
 const wait=new Promise(resolve=>{const listener=(event,result)=>{if(event.sender===win.webContents){ipcMain.removeListener('willyou-probe-result',listener);resolve(result)}};ipcMain.on('willyou-probe-result',listener)});
 const child=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'"><script>(async()=>{const errors=[],pcs=[];for(const url of ${JSON.stringify(['stun:127.0.0.1:'+ports.udp,'turn:127.0.0.1:'+ports.tcp+'?transport=tcp','turns:127.0.0.1:'+ports.tls+'?transport=tcp'])}){try{const pc=new RTCPeerConnection({iceServers:[{urls:url,username:'synthetic',credential:'synthetic'}]});pcs.push(pc);pc.createDataChannel('synthetic');await pc.setLocalDescription(await pc.createOffer());}catch(e){errors.push(String(e))}}setTimeout(()=>{for(const pc of pcs)pc.close();parent.postMessage({kind:'result',errors,connections:pcs.length},'*')},4000)})()</script>`;
 const outer=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; frame-src blob:; connect-src 'none'"><script>addEventListener('message',event=>{if(event.source===document.querySelector('iframe')?.contentWindow&&event.origin==='null'&&event.data?.kind==='result')window.probeResult.send(event.data)});addEventListener('DOMContentLoaded',()=>{const f=document.createElement('iframe');f.sandbox='allow-scripts';f.src=URL.createObjectURL(new Blob([${JSON.stringify(child).replace(/</g,'\\u003c')}],{type:'text/html'}));document.body.appendChild(f)})</script><body></body>`;
 await win.loadURL('data:text/html;base64,'+Buffer.from(outer).toString('base64'));const result=await wait;
 report.cases.push({guarded,ports,proxy,counts,result});win.destroy();udp.close();await Promise.all([new Promise(r=>tcp.close(r)),new Promise(r=>tls.close(r)),isolated.closeAllConnections(),isolated.clearStorageData()]);
}
app.whenReady().then(async()=>{await run(false);await run(true);const p=report.cases[0],n=report.cases[1];report.pass=p.counts.stunUdp>0&&p.counts.turnTcp>0&&p.counts.turnTls>0&&Object.values(n.counts).every(x=>x===0)&&Object.values(n.proxy).every(x=>!x.includes('DIRECT'));await finish(report.pass?0:1)});
