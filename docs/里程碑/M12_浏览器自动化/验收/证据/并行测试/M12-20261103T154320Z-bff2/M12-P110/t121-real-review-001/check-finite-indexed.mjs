// Actual saved finite corpus controls; no execution of JavaScript/Python in the journal.
import assert from'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';import{deriveIndexed}from'./finite-indexed-carrier.mjs';
const R='/private/tmp/willyou-m12-t121-actual-independent-001',E='/private/tmp/willyou-m12-t121-sop-static-001',r=JSON.parse(await readFile(E+'/raw.private.json')),p=r.cases[0].nativeSnapshotsBeforeStop[0],rows=(await readFile(p.path,'utf8')).split('\n').filter(Boolean).map(JSON.parse),checks=[];
const pairs=[];for(const request of rows.filter(x=>x.payload?.type==='custom_tool_call')){const output=rows.find(x=>x.payload?.type==='custom_tool_call_output'&&x.payload.call_id===request.payload.call_id);try{const derived=deriveIndexed({request,output});pairs.push({request,output});checks.push({name:'actual finite family '+request.payload.call_id,passed:derived.length>0});}catch{}}
assert.equal(pairs.length,5);const base=pairs.find(x=>x.request.payload.input.includes('resource read')&&x.request.payload.input.includes('262144'));assert(base);for(const[name,change]of[
 ['different output callID',p=>p.output.payload.call_id='other'],
 ['before-request timestamp',p=>p.output.timestamp='1970-01-01T00:00:00Z'],
 ['unexpected executable statement',p=>p.request.payload.input+='\nprocess.exit();'],
 ['dynamic nonliteral argument',p=>p.request.payload.input=p.request.payload.input.replace(/"?max_output_tokens"?\s*:\s*\d+/, '"max_output_tokens":process.env.X')],
 ['wrong indexed ordering',p=>{const o=JSON.parse(p.output.payload.output[1].text);o.i=9;p.output.payload.output[1].text=JSON.stringify(o)}],
 ['rejected rather than fulfilled',p=>{const o=JSON.parse(p.output.payload.output[1].text);o.status='rejected';p.output.payload.output[1].text=JSON.stringify(o)}],
 ['missing inner exit never forged',p=>{const o=JSON.parse(p.output.payload.output[1].text);delete o.value.exit_code;p.output.payload.output[1].text=JSON.stringify(o)}],
 ['extra unbound output block',p=>p.output.payload.output.push({type:'input_text',text:'unexpected'})]]){const p=structuredClone(base);change(p);assert.notEqual(JSON.stringify(p),JSON.stringify(base),'Negative fixture must actually change');assert.throws(()=>deriveIndexed(p),name);checks.push({name,passed:true,rejected:true});}
const positive=deriveIndexed(pairs[0]);assert.equal(positive[0].childExitCodeObserved,null);checks.push({name:'forwarded pwd output retains null unknown exit',passed:true});await writeFile(R+'/finite-controls.json',JSON.stringify({checks,count:checks.length,Native:0,JSExecuted:0,PythonExecuted:0},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({finiteControls:checks.length,passed:true}));
