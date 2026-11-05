import assert from 'node:assert/strict';
import {lstat,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
export async function verifyCleanup(r){
 const command=(exe,args)=>{const p=spawnSync(exe,args,{encoding:'utf8',timeout:5000});assert(!p.error,String(p.error));return{status:p.status,stdout:p.stdout,stderr:p.stderr};};
 const processes=(r.knownPids??[]).map(pid=>{const ps=command('/bin/ps',['-p',String(pid),'-o','pid=,ppid=,comm=']),tcp=command('/usr/sbin/lsof',['-nP','-a','-p',String(pid),'-iTCP','-sTCP:LISTEN']);return{pid,ps,tcp,absent:ps.status===1&&!ps.stdout.trim()&&tcp.status===1&&!tcp.stdout.trim()};});
 const ports=(r.knownPorts??[]).map(port=>{const observation=command('/usr/sbin/lsof',['-nP','-iTCP:'+port,'-sTCP:LISTEN']);return{port,...observation,closed:observation.status===1&&!observation.stdout.trim()};});
 const exactSockets=[];for(const path of r.exactSockets??[]){const row={path};try{const st=await lstat(path);row.absent=false;row.isSocket=st.isSocket()}catch(error){row.absent=error.code==='ENOENT';row.error=error.code}if(path.startsWith('/private/tmp/wy-cli-')){const parent=path.slice(0,path.lastIndexOf('/'));try{await lstat(parent);row.gatewayDirectory={path:parent,absent:false}}catch(error){row.gatewayDirectory={path:parent,absent:error.code==='ENOENT',error:error.code}}}exactSockets.push(row);}
 const remainingPrivateSockets=[];async function walk(path){for(const name of await readdir(path)){const child=path+'/'+name,st=await lstat(child);if(st.isSymbolicLink())continue;if(st.isSocket())remainingPrivateSockets.push(child);else if(st.isDirectory())await walk(child)}}
 await walk(r.scratch+'/tmp');
 return{at:new Date().toISOString(),processes,ports,exactSockets,remainingPrivateSockets,allClear:processes.length>0&&processes.every(x=>x.absent)&&ports.every(x=>x.closed)&&exactSockets.every(x=>x.absent&&(!x.gatewayDirectory||x.gatewayDirectory.absent))&&remainingPrivateSockets.length===0,boundary:'Exact recorded App descendants/metrics PIDs, native/debug listeners and own Server socket addresses; final private TMP scan. No unknown PID is killed. Runner itself closes separately in coordinator exec receipt; no Helper or PTY was intentionally created.'};
}
