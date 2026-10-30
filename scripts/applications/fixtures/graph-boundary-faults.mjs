// T65 step 15: private fault injection, never a real different-volume claim.
import assert from 'node:assert/strict';
import {lstat,readFile,writeFile,rename,symlink,readlink,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const identity=s=>({dev:s.dev,ino:s.ino,mode:s.mode&0o777});
export const boundaryModes=['exdev-h','exdev-c','symlink-h','symlink-c'];
export async function installBoundaryFault(app,{mode,home,userData}){
 assert(boundaryModes.includes(mode));
 return app.mainEvaluate(`(()=>{const fs=process.getBuiltinModule('fs'),cp=process.getBuiltinModule('child_process'),g={remove:fs.rmSync,exec:cp.execFileSync,used:false,moves:[],removes:[]};globalThis.__m10GraphBoundary=g;
 const home=${JSON.stringify(home)},root=${JSON.stringify(userData+'/capabilities')},scope=${JSON.stringify(mode.endsWith('-h')?'H':'C')},exdev=${mode.startsWith('exdev-')};
 cp.execFileSync=function(file,args,options){if(Array.isArray(args)&&['--move-discovery-directory','--restore-owned-directory'].includes(args[0])&&[home,root].includes(args[1])){const actual=args[0]==='--move-discovery-directory'?'H':'C',entry={scope:actual,root:args[1],from:args[2],to:args[3]};g.moves.push(entry);if(exdev&&!g.used&&actual===scope){g.used=true;entry.injected='EXDEV';return JSON.stringify({schema:1,restored:false,error:'EXDEV'});}}return g.exec.apply(this,arguments);};
 fs.rmSync=function(path,options){if(typeof path==='string'&&path.endsWith('/payload')&&(path.startsWith(home+'/.agents/smartdd-runtime/trash/')||path.startsWith(root+'/trash/'))){g.removes.push(path);if(!exdev&&!g.used){g.used=true;const e=Error('Private T65 pre-delete boundary');e.code='EIO';throw e;}}return g.remove.apply(this,arguments);};return true})()`);
}
export async function finishBoundaryFault({getApp,active,plan,op,old,sql,start,quit,tree,check,home,userData}){
 let app=getApp();
 active.boundaryFault=await app.mainEvaluate("(()=>{const g=globalThis.__m10GraphBoundary;process.getBuiltinModule('fs').rmSync=g.remove;process.getBuiltinModule('child_process').execFileSync=g.exec;const out={used:g.used,moves:g.moves,removes:g.removes};delete globalThis.__m10GraphBoundary;return out})()");
 const fault=active.boundaryFault;assert(fault.used);assert.equal(active.request.value.ok,false);
 assert(plan.nodes.some(n=>n.resource.pathScope==='H'));assert(plan.nodes.some(n=>n.resource.pathScope==='C'));
 active.retainedTrees=[];
 for(const n of plan.nodes){const isH=n.resource.pathScope==='H';assert.equal(n.tree.anchor,isH?home:join(userData,'capabilities'));assert(n.trashRelative.startsWith(isH?'.agents/smartdd-runtime/trash/':'trash/'));assert.equal(sql("SELECT state FROM capability_resources WHERE resource_id='"+n.resource.resourceId+"'")[0].state,'deleting');
  const source=join(n.tree.anchor,n.resource.relativePath),payload=join(n.tree.anchor,n.trashRelative,'payload');let path;try{await lstat(source);path=source;}catch(e){assert.equal(e.code,'ENOENT');path=payload;}
  assert.deepEqual(await tree(path),Object.fromEntries(n.tree.entries.filter(e=>e.kind==='file').map(e=>[e.path,{sha256:e.hash,mode:e.identity.mode}])));assert.deepEqual(identity(await lstat(path)),n.tree.directory);
  const actual={resourceId:n.resource.resourceId,path,directory:identity(await lstat(path)),entries:[]};
  for(const e of n.tree.entries){const entry={path:e.path,identity:identity(await lstat(join(path,e.path)))};assert.deepEqual(entry.identity,e.identity);actual.entries.push(entry);}
  active.retainedTrees.push(actual);
 }
 if(active.mode.startsWith('exdev-')){
  assert.equal(active.request.value.code,'RESOURCE_RECOVERY_REQUIRED');assert.equal(fault.removes.length,0);assert.equal(fault.moves.filter(m=>m.injected).length,1);assert.equal(fault.moves.at(-1).injected,'EXDEV');assert.equal(fault.moves.at(-1).scope,active.mode.endsWith('-h')?'H':'C');
  active.errorBoundary={code:active.request.value.code,moves:fault.moves,physicalDeleteCalls:0};
  check('Selected H/C native EXDEV response retains every original inode and byte, leaves deleting rows and performs no physical deletion or cross-root fallback');
  await quit('exdev-retained');await start();
  check('Ordinary restart after removing only the EXDEV wrapper resumes the immutable same-root H/C plan');return;
 }
 assert.equal(fault.removes.length,1);
 const node=plan.nodes.find(n=>n.resource.pathScope===(active.mode.endsWith('-h')?'H':'C')),entry=node.tree.entries.find(e=>e.kind==='file');assert(entry);
 const payload=join(node.tree.anchor,node.trashRelative,'payload'),link=join(payload,entry.path),backup=join(active.dir,'original-owned-entry'),outside=join(active.dir,'outside-canary.txt');
 await quit('before-private-link-injection');
 const bytes=await readFile(link),originalIdentity=identity(await lstat(link));assert.equal(hash(bytes),entry.hash);assert.deepEqual(originalIdentity,entry.identity);
 await writeFile(outside,'T65 external target must survive '+active.mode+'\n',{flag:'wx',mode:0o600});const outsideBytes=await readFile(outside),outsideIdentity=identity(await lstat(outside));
 await rename(link,backup);await symlink(outside,link);const linkIdentity=identity(await lstat(link));
 active.linkFault={scope:node.resource.pathScope,resourceId:node.resource.resourceId,link,backup,outside,originalIdentity,originalSha256:hash(bytes),outsideIdentity,outsideSha256:hash(outsideBytes),linkIdentity};
 await start();app=getApp();const listed=await app.invoke('applications.versions','zentao');assert(listed.ok);assert(listed.value.recoveryPending>0);
 const recovery=listed.value.items.find(i=>i.packageHash===old.packageHash).cleanupRecovery;assert(recovery);assert.equal(recovery.canCancel,false);
 const cancel=await app.invoke('applications.cancelCleanup',{appId:'zentao',packageHash:old.packageHash,operationId:recovery.operationId,planHash:recovery.planHash});assert.equal(cancel.ok,false);assert.equal(cancel.code,'OWNERSHIP_CONFLICT');
 assert.equal((await lstat(link)).isSymbolicLink(),true);assert.equal(await readlink(link),outside);assert.deepEqual(identity(await lstat(link)),linkIdentity);assert.deepEqual(await readFile(outside),outsideBytes);assert.deepEqual(identity(await lstat(outside)),outsideIdentity);
 for(const n of plan.nodes)assert.equal(sql("SELECT state FROM capability_resources WHERE resource_id='"+n.resource.resourceId+"'")[0].state,'deleting');
 const current=sql("SELECT * FROM capability_resource_operations WHERE operation_id='"+op.operation_id+"'")[0];assert.equal(current.plan_json,op.plan_json);assert(!['canceled','committed'].includes(current.state));active.linkFault.deniedCancel=cancel;active.linkFault.pending=listed.value.recoveryPending;
 check('Ordinary recovery and explicit cancellation reject the injected H/C symlink; external target bytes/inode, link and deleting rows remain intact');
 await quit('link-protected');assert.equal(await readlink(link),outside);assert.deepEqual(identity(await lstat(link)),linkIdentity);assert.deepEqual(identity(await lstat(backup)),originalIdentity);assert.deepEqual(await readFile(backup),bytes);
 await unlink(link);await rename(backup,link);assert.deepEqual(identity(await lstat(link)),originalIdentity);assert.deepEqual(await readFile(link),bytes);active.linkFault.restoredOriginalIdentity=identity(await lstat(link));
 await start();assert.deepEqual(await readFile(outside),outsideBytes);assert.deepEqual(identity(await lstat(outside)),outsideIdentity);
 check('Removing only the injected link and restoring the exact original inode allows ordinary recovery; external canary remains untouched');
}
