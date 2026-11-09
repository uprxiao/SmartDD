// Future authorized runtime cleanup only. No operation on import; no token/env reads.
import assert from'node:assert/strict';import{readFile,lstat,access}from'node:fs/promises';import{execFile}from'node:child_process';import{promisify}from'node:util';import{sha}from'./io.mjs';
const exec=promisify(execFile),sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
export function exactIdentity(a,b){return a?.state==='running'&&a.pid===b.pid&&a.startedAt===b.startedAt}
export async function cleanupDetached({root,pin,state,parent}){
 assert(root.startsWith('/private/tmp/willyou-m12-t043-'));const executable=pin.app+'/Contents/Resources/native/willyou-process-identity',expected=pin.packageFiles.find(f=>f.path==='native/willyou-process-identity');assert.equal(sha(await readFile(executable)),expected.sha256);
 const identities=[state?.worker,parent?.worker,parent?.parentIdentity,...(state?.knownChildren??[]).map(x=>x.identity)].filter(Boolean),unique=[...new Map(identities.map(x=>[x.pid,x])).values()],steps=[];
 const read=async id=>{const r=await exec(executable,[String(id.pid)],{timeout:4000,maxBuffer:65536});return JSON.parse(r.stdout)};
 // Allow completed non-child worker to be reaped naturally before any cleanup signal.
 for(const id of unique){let now=await read(id);if(exactIdentity(now,id)){await sleep(1000);now=await read(id)}const row={identity:id,before:now,signals:[]};steps.push(row);for(const signal of['SIGTERM','SIGKILL']){if(!exactIdentity(now,id))break;process.kill(id.pid,signal);row.signals.push({signal,at:new Date().toISOString()});const end=Date.now()+2500;do{await sleep(100);now=await read(id)}while(exactIdentity(now,id)&&Date.now()<end)}row.after=now;row.originalNoLongerRunning=now.state==='stopped'||now.state==='running'&&!exactIdentity(now,id);}
 const unbound=[...(state?.knownChildren??[]).filter(x=>!x.identity).map(x=>x.pid),...(parent?.workerPid&&!parent?.worker&&!state?.worker?[parent.workerPid]:[])];
 // An unknown live birth is never signalled or called cleared.
 const unknown=[];for(const pid of unbound){const v=await read({pid});if(v.state!=='stopped')unknown.push({pid,...v})}return{steps,unknown,allClear:steps.every(x=>x.originalNoLongerRunning)&&unknown.length===0,boundary:'Identity helper treats zombie/nonrunning as not-running; OS ps inventory below separately checks remaining owned PID, no kernel exit code is invented for detached worker'};
}
export async function verifyOwnedResources({knownPids,knownPorts,exactGatewayPaths,driverPid}){
 const ids=[...new Set(knownPids)].filter(x=>Number.isSafeInteger(x)&&x>1&&x!==driverPid),processRows=[];
 for(const pid of ids){try{const r=await exec('/bin/ps',['-p',String(pid),'-o','pid=,ppid=,lstart=,comm='],{timeout:4000,maxBuffer:65536});if(r.stdout.trim())processRows.push({pid,row:r.stdout.trim()})}catch(e){if(e.code!==1)throw e}}
 const ports=[];for(const port of new Set(knownPorts)){try{const r=await exec('/usr/sbin/lsof',['-nP','-iTCP:'+port,'-sTCP:LISTEN'],{timeout:5000,maxBuffer:65536});ports.push({port,closed:!r.stdout.trim(),output:r.stdout})}catch(e){if(e.code!==1)throw e;ports.push({port,closed:true})}}
 const unix=[];for(const path of new Set(exactGatewayPaths)){assert(/^\/(?:private\/)?tmp\/wy-(?:cli-)?[^/]+\/(?:cli|broker)\.sock$/.test(path));let absent=false;try{await lstat(path)}catch(e){if(e.code!=='ENOENT')throw e;absent=true}const directory=path.slice(0,path.lastIndexOf('/'));let directoryAbsent=false;try{await access(directory)}catch(e){if(e.code!=='ENOENT')throw e;directoryAbsent=true}unix.push({path,absent,directory,directoryAbsent})}
 return{at:new Date().toISOString(),pids:ids,remainingProcesses:processRows,ports,unix,allClear:!processRows.length&&ports.every(x=>x.closed)&&unix.every(x=>x.absent&&x.directoryAbsent),helperBoundary:'Only tab list is requested; no browser pages/Helper expected. Actual process inventory and any unexpected owned process remain part of cleanup, not silently excluded.'};
}
