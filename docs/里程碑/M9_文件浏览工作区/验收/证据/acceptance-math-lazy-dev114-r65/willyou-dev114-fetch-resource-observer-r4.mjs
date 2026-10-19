// Own test CDP target only; no protocol or existing webRequest listener changes.
// Hold native module responses, compare original bytes, then continue untouched.
// Explicit Fetch.failRequest faults produce native Worker load errors, not output.
import { createHash } from 'node:crypto';
const states = new WeakMap(), sha = value => createHash('sha256').update(value).digest('hex');
export async function installMathResourceObserver(app) {
 const s={rows:[],slots:[],pending:new Set(),errors:[],failNext:false,holdNext:false,active:true};states.set(app.evaluate,s);
 const accept=async event=>{
  const row={url:event.request.url,method:event.request.method,status:event.responseStatusCode,at:Date.now()};s.rows.push(row);
  if(s.failNext){s.failNext=false;row.failureInjected='Fetch.failRequest Failed';await app.cdp('Fetch.failRequest',{requestId:event.requestId,errorReason:'Failed'});row.returnedAt=Date.now();return;}
  const bytes=async()=>{const body=await app.cdp('Fetch.getResponseBody',{requestId:event.requestId});return Buffer.from(body.body,body.base64Encoded?'base64':'utf8');};row.before=sha(await bytes());
  if(s.holdNext){s.holdNext=false;const slot={rowIndex:s.rows.indexOf(row),waiting:true};s.slots.push(slot);await new Promise(done=>slot.release=()=>{if(!slot.waiting)return;slot.waiting=false;done();});}
  row.after=sha(await bytes());if(row.before!==row.after)throw Error('Original module response bytes changed');
  await app.cdp('Fetch.continueResponse',{requestId:event.requestId});row.returnedAt=Date.now();
 };
 s.off=app.onCDP('Fetch.requestPaused',event=>{const pending=accept(event);s.pending.add(pending);pending.catch(error=>{s.errors.push(String(error));return app.cdp('Fetch.continueRequest',{requestId:event.requestId}).catch(()=>{});}).finally(()=>s.pending.delete(pending));});
 await app.cdp('Fetch.enable',{patterns:[{urlPattern:'*markdown-math-worker*',requestStage:'Response'}]});return {kind:'original CDP Fetch response',active:true,webRequestUntouched:true,protocolUntouched:true};
}
export async function failNextMathResource(app){states.get(app.evaluate).failNext=true;return true;}
export async function holdNextMathResource(app){states.get(app.evaluate).holdNext=true;return true;}
export async function observeMathResources(app){const s=states.get(app.evaluate);return {kind:'original CDP Fetch response',active:s.active,rows:structuredClone(s.rows),slots:s.slots.map(({release,...slot})=>({...slot})),errors:[...s.errors]};}
export async function releaseMathResources(app){states.get(app.evaluate).slots.filter(x=>x.waiting).forEach(x=>x.release());return true;}
export async function restoreMathResourceObserver(app){const s=states.get(app.evaluate);s.failNext=s.holdNext=false;await releaseMathResources(app);await Promise.all([...s.pending]);await app.cdp('Fetch.disable');s.off();s.active=false;states.delete(app.evaluate);return {restored:true,allSlotsReleased:s.slots.every(x=>!x.waiting),noObserverErrors:s.errors.length===0,webRequestUntouched:true,protocolUntouched:true};}
