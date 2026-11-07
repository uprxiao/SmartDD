import assert from'node:assert/strict';
import{readFile,lstat}from'node:fs/promises';
import{createHash}from'node:crypto';
export const sha=x=>createHash('sha256').update(x).digest('hex');
export async function loadAcceptedEight(reuse,pin,oracle){
 assert.equal(reuse.root,'/private/tmp/willyou-m12-t130-F21-App035-A-cont-002');const bytes=await readFile(reuse.root+'/raw.json'),cleanupBytes=await readFile(reuse.root+'/cleanup.json');assert.equal(sha(bytes),reuse.rawSHA256);assert.equal(sha(cleanupBytes),reuse.cleanupSHA256);const raw=JSON.parse(bytes),cleanup=JSON.parse(cleanupBytes),mode=raw.modes[0];
 assert.equal(raw.asarSHA256,pin.asarSha256);assert.equal(raw.sourceManifestSHA256,pin.sourceManifestSha256);assert.equal(mode.appExit.code,0);assert.equal(mode.appExit.signal,null);assert.deepEqual(mode.observedProcess.signals,[]);assert(mode.appCleanup.normalExitConfirmed);assert(cleanup.allClear);assert(mode.focusGuard.enabled&&!mode.focusGuard.yielded);assert.equal(mode.initialForeground.attempts,1);assert(mode.initialFocus.actualStableMs>=3000);assert(Object.values(mode.restored).every(Boolean));assert.deepEqual(mode.after,mode.before);
 const checks=mode.checks.filter(c=>c.complete),keys=checks.map(c=>c.theme+':'+c.file);assert.deepEqual(keys,reuse.keys);assert.equal(checks.length,8);assert(checks.every(c=>c.theme==='light'&&c.actualCloseNoNotebook));
 assert.equal(reuse.project, reuse.root+'/runtime-001/normal/project');assert.equal(raw.fixtureMaterialization.canary,reuse.root+'/runtime-001/must-not-execute');assert(Number.isSafeInteger(raw.fixtureMaterialization.trapPort)&&raw.fixtureMaterialization.trapPort>1024);
 for(const item of oracle.cases){const p=reuse.project+'/'+item.name,b=await readFile(p),s=await lstat(p,{bigint:true}),actual={sha256:sha(b),size:String(s.size),device:String(s.dev),inode:String(s.ino),mode:Number(s.mode&511n),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)};assert.deepEqual(actual,mode.before[item.name],p);}
 for(const c of checks){const b=await readFile(reuse.project+'/'+c.file);assert.deepEqual(c.after,mode.before);assert(c.actualInputRead.some(x=>x.offset===0&&x.size===b.length&&x.revisionHash===sha(b)&&Buffer.from(x.base64,'base64').equals(b)));}
 return{raw,mode,checks,keys,cleanup};
}
