// Independent checks over the saved native Agent results; the driver exit code is not a verdict.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,dirname} from 'node:path';
const path=process.argv[2];assert(path,'Pass the saved result.json');
const bytes=await readFile(path),r=JSON.parse(bytes),checks=[];
const nativeRows=[];
for(const source of new Set((r.nativeContexts??[]).map(c=>c.source))){
 assert(source.startsWith(r.root+'/codex/sessions/'),'Only this fixture native state');
 const raw=await readFile(source),hash=createHash('sha256').update(raw).digest('hex');
 assert(r.nativeContexts.filter(c=>c.source===source).every(c=>c.sha256===hash),'Native source changed since capture');
 for(const [i,line] of raw.toString().split('\n').entries()){if(!line)continue;const row=JSON.parse(line);if(row.type==='turn_context')nativeRows.push({source,sourceSha256:hash,line:i+1,row});}
}
await writeFile(join(dirname(path),'native-contexts.jsonl'),nativeRows.map(row=>JSON.stringify(row)).join('\n')+'\n');
const check=(name,fn)=>{fn();checks.push(name);};
let error;
try{
 check('actual managed native CLI baseline',()=>{assert(r.sandbox.probe);assert(r.sandbox.noBypass);assert.match(r.cliSha256,/^[a-f0-9]{64}$/);assert.match(r.asarSha256,/^[a-f0-9]{64}$/);assert(!r.fixtureFailure);});
 check('gateway reachable before and after restart',()=>{assert(r.firstComplete&&r.restartComplete);for(const name of ['create','small-snapshot','new-run-get'])assert(r.outputs.some(o=>o.step===name));assert.notEqual(r.firstSession.currentRun.id,r.restartSession.currentRun.id);});
 check('approval and sandbox read from both actual native journals',()=>{assert(nativeRows.length>=2);const sources=new Set();for(const c of nativeRows){sources.add(c.source);assert.equal(c.row.payload.approval_policy,r.sandbox.approval);assert.equal(c.row.payload.sandbox_policy.type,r.sandbox.policyMode==='read-only'?'read-only':'workspace-write');}assert(sources.size>=2);});
 check('original stored explicit or named profile preserved',()=>{const args=r.storedProfileArgs;assert(Array.isArray(args));const i=args.indexOf('--ask-for-approval');assert(i>=0);assert.equal(args[i+1],r.sandbox.approval);if(r.sandbox.policyMode!=='named-workspace'){const s=args.indexOf('--sandbox');assert(s>=0);assert.equal(args[s+1],r.sandbox.policyMode);}assert(!args.some(x=>x.includes('wy_cli_')||x.includes('dangerously-bypass')||x==='--yolo'));});
 check('filesystem boundaries independently observed',()=>{const writes=r.filesystemPolicy.writes;assert.equal(writes.length,2);assert.equal(writes.find(x=>x.name==='inside').wrote,r.sandbox.policyMode!=='read-only');assert.equal(writes.find(x=>x.name==='outside').wrote,false);assert(!r.unexpectedOutsideCanaryRemoved);});
 check('unrelated Unix socket remains denied',()=>{assert.equal(r.filesystemPolicy.otherSocketConnected,false);assert.equal(r.decoyConnections,0);assert(r.decoyClosed);});
 check('direct TCP remains denied',()=>{assert.equal(r.filesystemPolicy.directTcpConnected,false);});
 check('large artifacts actually read by native sandbox',()=>{assert.equal(r.files.length,3);for(const f of r.files){const read=r.sandboxRead.files.find(x=>x.path===f.path);assert(read?.parsed);assert.equal(read.bytes,f.bytes);assert.equal(read.sha256,f.sha256);}});
 check('write sent once and owned fixture restored',()=>{assert.equal(r.commits.length,1);assert(r.faultRestored);assert(r.firstAppClosed&&r.appClosed);});
}catch(e){error=String(e.stack??e);}
const verdict={schema:'m12-codex-policy-verdict-v1',at:new Date().toISOString(),source:path,sourceSha256:createHash('sha256').update(bytes).digest('hex'),status:error?'failed':'passed',checks,...(error?{error}:{})};
await writeFile(join(dirname(path),'policy-adjudication.json'),JSON.stringify(verdict,null,2)+'\n');
console.log(JSON.stringify(verdict));if(error)process.exitCode=1;
