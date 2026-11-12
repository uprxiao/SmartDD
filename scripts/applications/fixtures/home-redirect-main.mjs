// Pre-entry hook for a private packaged App copy: point Electron's `home` path at the run's isolated HOME before any
// App code runs. On macOS app.getPath('home') ignores the HOME environment variable, so without this an isolated
// acceptance run would read and write the real user's ~/.agents/skills and ~/.claude/skills.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {isM13HomePath} from '../../lib/electron-isolation-paths.mjs';

export async function redirectHome({logs,isRunning,home}){
 assert(home.startsWith('/private/tmp/willyou-m11-')||isM13HomePath(home),'Isolated HOME only');
 const end=Date.now()+15000,until=async(fn,label)=>{while(Date.now()<end){const v=fn();if(v)return v;if(!isRunning())throw Error('App exited before entry: '+logs());await new Promise(r=>setTimeout(r,20));}throw Error('Bounded entry hook: '+label);};
 const url=await until(()=>logs().match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+)/)?.[1],'main inspector');
 const ws=new WebSocket(url);await once(ws,'open');let seq=0;const waiting=new Map(),pauses=[];
 ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}if(m.method==='Debugger.paused')pauses.push(m.params);});
 const rpc=(method,params={})=>new Promise((ok,fail)=>{const id=++seq;waiting.set(id,m=>m.error?fail(Error(method+': '+m.error.message)):ok(m.result));ws.send(JSON.stringify({id,method,params}));});
 try{
  await rpc('Runtime.enable');await rpc('Debugger.enable');await rpc('Runtime.runIfWaitingForDebugger');
  const pause=await until(()=>pauses[0],'entry pause');
  const value=await rpc('Debugger.evaluateOnCallFrame',{callFrameId:pause.callFrames[0].callFrameId,returnByValue:true,expression:`(()=>{const E=process.getBuiltinModule('module').createRequire(process.execPath)('electron');E.app.setPath('home',${JSON.stringify(home)});return E.app.getPath('home');})()`});
  assert.equal(value.result?.value,home,'home path not redirected: '+JSON.stringify(value));
  await rpc('Debugger.resume');return{home:value.result.value,at:new Date().toISOString()};
 }finally{ws.close();}
}
