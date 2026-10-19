// Own CDP target only. Pause actual native Worker initialization with Chromium's
// debugger-start handshake; script bytes and Worker messages remain unchanged.
// Missing-module faults are explicit constructor URL faults, not fake errors.
const states = new WeakMap();
export async function installMathResourceObserver(app) {
 const s={rows:[],slots:[],errors:[],holdNext:false,active:true,pending:new Set(),detached:new Set()};states.set(app.evaluate,s);
 const run=async(event,row)=>{try{await app.cdp('Target.sendMessageToTarget',{sessionId:event.sessionId,message:JSON.stringify({id:1,method:'Runtime.runIfWaitingForDebugger'})});if(row)row.resumedAt=Date.now();}catch(error){if(s.detached.has(event.sessionId)||/session|target.*closed/i.test(String(error))){if(row)row.releasedAfterTermination=true;}else throw error;}};
 s.detach=app.onCDP('Target.detachedFromTarget',event=>{s.detached.add(event.sessionId);const row=s.rows.find(x=>x.sessionId===event.sessionId);if(row)row.detachedAt=Date.now();});
 s.off=app.onCDP('Target.attachedToTarget',event=>{const accept=async()=>{if(event.targetInfo.type==='worker'&&event.targetInfo.url.includes('markdown-math-worker')){const row={url:event.targetInfo.url,sessionId:event.sessionId,at:Date.now(),waitingForDebugger:event.waitingForDebugger};s.rows.push(row);if(s.holdNext){s.holdNext=false;if(!event.waitingForDebugger)throw Error('Native math Worker was not paused before initialization');const slot={rowIndex:s.rows.indexOf(row),waiting:true};s.slots.push(slot);await new Promise(done=>slot.release=()=>{if(!slot.waiting)return;slot.waiting=false;done();});}await run(event,row);}else await run(event);};const pending=accept();s.pending.add(pending);pending.catch(error=>s.errors.push(String(error))).finally(()=>s.pending.delete(pending));});
 await app.cdp('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:false});return {kind:'native Worker debugger-start pause',active:true,webRequestUntouched:true,protocolUntouched:true};
}
export async function failNextMathResource(app){return app.evaluate('globalThis.__markdownObservation.failMathResource=true;true');}
export async function holdNextMathResource(app){states.get(app.evaluate).holdNext=true;return true;}
export async function observeMathResources(app){const s=states.get(app.evaluate);return {kind:'native Worker debugger-start pause',active:s.active,rows:structuredClone(s.rows),slots:s.slots.map(({release,...slot})=>({...slot})),errors:[...s.errors]};}
export async function releaseMathResources(app){states.get(app.evaluate).slots.filter(x=>x.waiting).forEach(x=>x.release());return true;}
export async function restoreMathResourceObserver(app){const s=states.get(app.evaluate);s.holdNext=false;await releaseMathResources(app);await Promise.all([...s.pending]);await app.cdp('Target.setAutoAttach',{autoAttach:false,waitForDebuggerOnStart:false,flatten:false});s.off();s.detach();states.delete(app.evaluate);return {restored:true,allSlotsReleased:s.slots.every(x=>!x.waiting),noObserverErrors:s.errors.length===0,webRequestUntouched:true,protocolUntouched:true};}
