"use strict";
const { app, BaseWindow, BrowserWindow, WebContentsView } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const root = process.env.WY_F36_PROBE_ROOT;
if (!root || !/^\/private\/tmp\/willyou-f36-review-[A-Za-z0-9_-]+$/.test(root)) throw new Error("Expected private probe root");
app.setName("WillYou F36 isolated cold-host probe");
for (const [name, dir] of [["userData", "user-data"], ["sessionData", "session-data"], ["logs", "logs"]]) {
  const target = path.join(root, dir);
  fs.mkdirSync(target, { recursive: true });
  app.setPath(name, target);
}
const shellHtml = path.join(root, "shell.html"), pageHtml = path.join(root, "page.html");
fs.writeFileSync(shellHtml, '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#224e68;color:white;font:18px system-ui}</style><p>Isolated shell fixture</p>');
fs.writeFileSync(pageHtml, '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;background:#a8a8a8;overflow:hidden}button{position:absolute;left:30px;top:30px;width:130px;height:75px}#marker{position:absolute;left:240px;top:160px;width:120px;height:95px;background:#111111}</style><button id="counter">Count 0</button><div id="marker"></div><script>window.clicks=0;window.ticks=0;document.querySelector("#counter").addEventListener("click",()=>{window.clicks++;document.querySelector("#counter").textContent="Count "+window.clicks;document.querySelector("#marker").style.background="#ff0000";});setInterval(()=>window.ticks++,100);</script>');
const ledger = path.join(root, "cold-host.jsonl");
const prefs = { sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false };
function record(event, fields) { fs.appendFileSync(ledger, JSON.stringify({event, ...fields})+"\n"); }
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function bounded(name, operation, ms=3500) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(name+" timed out")),ms);})]); }
  finally { clearTimeout(timer); }
}
async function waitFor(name, read, predicate, ms=2500) {
  const deadline=Date.now()+ms;
  while(Date.now()<deadline) { const current=await bounded(name+" state",read,1000); if(predicate(current)) return current; await sleep(40); }
  throw new Error(name+" not observed before deadline");
}
function state(contents) { return contents.executeJavaScript('({ clicks:window.clicks, ticks:window.ticks, width:innerWidth, height:innerHeight, documentVisibility:document.visibilityState })'); }
async function scenario(name, reacquire) {
  let win, shell, page, shellWC, pageWC;
  const result={name, mode:"never-shown BaseWindow; fixed local fixture only", everShown:false};
  try {
    win=new BaseWindow({width:800,height:600,minWidth:700,minHeight:500,title:"WillYou F36 isolated cold-host probe",show:false,backgroundColor:"#111111",...(process.platform==="darwin"?{titleBarStyle:"hiddenInset",titleBarOverlay:{height:40},trafficLightPosition:{x:14,y:14},acceptFirstMouse:true}:{})});
    win.on("show",()=>{result.everShown=true;});
    shell=new WebContentsView({webPreferences:prefs}); shellWC=shell.webContents;
    win.contentView.addChildView(shell);
    const {width,height}=win.getContentBounds();
    shell.setBounds({x:0,y:0,width,height});
    let shellLoadObserved=false; shellWC.once("did-finish-load",()=>{shellLoadObserved=true;});
    await bounded("load isolated shell",()=>shellWC.loadFile(shellHtml),5000);
    const browserOwner=BrowserWindow.fromWebContents(shellWC);
    const describeOwner=(owner)=>owner?{ id:owner.id, sameObject:owner===win, constructor:owner.constructor?.name??null, isBaseWindow:owner instanceof BaseWindow, isBrowserWindow:owner instanceof BrowserWindow, hasOwnWebContents:!!owner.webContents }:null;
    result.ownerLookup={shell:describeOwner(browserOwner),baseWindowFromId:describeOwner(BaseWindow.fromId(win.id)),browserWindowFromId:describeOwner(BrowserWindow.fromId(win.id))};
    result.host={id:win.id,visible:win.isVisible(),focused:win.isFocused(),baseWindowCount:BaseWindow.getAllWindows().length,browserWindowCount:BrowserWindow.getAllWindows().length,hasWindowWebContents:!!win.webContents,browserWindowFromShell:browserOwner?.id??null,baseIdResolves:BaseWindow.fromId(win.id)?.id===win.id,shellLoadObserved,shellId:shellWC.id,contentBounds:win.getContentBounds(),shellBounds:shell.getBounds(),windowButtonPosition:process.platform==="darwin"?win.getWindowButtonPosition():null};
    page=new WebContentsView({webPreferences:prefs}); pageWC=page.webContents;
    win.contentView.addChildView(page,0);
    page.setBounds({x:30,y:60,width:440,height:300});
    result.layerOrder=win.contentView.children.map(child=>child===page?"page":child===shell?"shell":"unknown");
    result.layerCorrect=result.layerOrder.join(",")==="page,shell";
    result.ownerLookup.page=describeOwner(BrowserWindow.fromWebContents(pageWC));
    result.ownerLookup.shellAndPageAreDifferentWebContents=shellWC.id!==pageWC.id;
    await bounded("load local page",()=>pageWC.loadFile(pageHtml),5000);
    const pageBefore=await bounded("read fixture",()=>state(pageWC));
    if (reacquire) {
      page.setVisible(false);
      const tickAfterIdle=await waitFor("idle tick",()=>state(pageWC),value=>value.ticks>pageBefore.ticks,1500).catch(error=>({error:String(error)}));
      result.idle={before:pageBefore,after:tickAfterIdle};
      page.setVisible(true);
    }
    pageWC.debugger.attach("1.3");
    await bounded("page focus emulation",()=>pageWC.debugger.sendCommand("Emulation.setFocusEmulationEnabled",{enabled:true}));
    result.pageFocusEmulation=true;
    result.before=await bounded("read before click",()=>state(pageWC));
    const inputStart=Date.now();
    try {
      await bounded("fixed fixture click",async()=>{
        const event={x:80,y:65,button:"left",clickCount:1};
        await pageWC.debugger.sendCommand("Input.dispatchMouseEvent",{...event,type:"mousePressed"});
        await pageWC.debugger.sendCommand("Input.dispatchMouseEvent",{...event,type:"mouseReleased"});
      },2800);
      result.after=await waitFor("actual click",()=>state(pageWC),value=>value.clicks===result.before.clicks+1);
      result.clickDelta=result.after.clicks-result.before.clicks;
    } catch(error) { result.inputError=String(error);result.after=await bounded("state after failed click",()=>state(pageWC),1000).catch(()=>null); }
    result.inputMs=Date.now()-inputStart;
    const captureStart=Date.now();
    try {
      const reply=await bounded("page capture",()=>pageWC.debugger.sendCommand("Page.captureScreenshot",{format:"png"}),3000);
      const bytes=Buffer.from(reply.data,"base64"),fileName=name+"-capture.png";
      fs.writeFileSync(path.join(root,fileName),bytes);
      result.capture={file:fileName,sha256:crypto.createHash("sha256").update(bytes).digest("hex"),ms:Date.now()-captureStart};
    } catch(error) { result.captureError=String(error);result.captureMs=Date.now()-captureStart; }
    result.final={visible:win.isVisible(),focused:win.isFocused(),baseWindowCount:BaseWindow.getAllWindows().length,browserWindowCount:BrowserWindow.getAllWindows().length,shellWCId:shellWC.id,pageWCId:pageWC.id,layerOrder:win.contentView.children.map(child=>child===page?"page":child===shell?"shell":"unknown")};
  } catch(error) { result.driverError=String(error); }
  finally {
    try {
      if(pageWC&&!pageWC.isDestroyed()&&pageWC.debugger.isAttached())pageWC.debugger.detach();
      if(pageWC&&!pageWC.isDestroyed())pageWC.close({waitForBeforeUnload:false});
      if(shellWC&&!shellWC.isDestroyed())shellWC.close({waitForBeforeUnload:false});
      if(win&&!win.isDestroyed())win.destroy();
      result.cleanup=await waitFor("fixture cleanup",async()=>({shellDestroyed:!shellWC||shellWC.isDestroyed(),pageDestroyed:!pageWC||pageWC.isDestroyed(),windowDestroyed:!win||win.isDestroyed(),remainingWindows:BaseWindow.getAllWindows().length}),x=>x.shellDestroyed&&x.pageDestroyed&&x.windowDestroyed&&x.remainingWindows===0,2000);
    } catch(error) { result.cleanupError=String(error); }
    record("scenario",result);
  }
}
app.on("window-all-closed",()=>{});
app.whenReady().then(async()=>{
  const watchdog=setTimeout(()=>{record("watchdog",{reason:"own probe timeout"});for(const win of BaseWindow.getAllWindows())if(!win.isDestroyed())win.destroy();app.exit(2);},35000);
  record("environment",{electron:process.versions.electron,chromium:process.versions.chrome,platform:process.platform,arch:process.arch,fixtureOnly:true});
  await scenario("cold-after-shell",false);
  await scenario("cold-idle-reacquire",true);
  clearTimeout(watchdog);
  record("complete",{remainingWindows:BaseWindow.getAllWindows().length});
  app.exit(0);
}).catch(error=>{record("startup-error",{error:String(error)});app.exit(1);});
