// Real, private APFS filesystem for T65; no synthetic EXDEV response or user volume.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,lstat,rename,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const identity=s=>({dev:s.dev,ino:s.ino,mode:s.mode&0o777,size:s.size});
export async function attachGraphVolume(active){
 assert(active.dir.startsWith('/private/tmp/willyou-m10-graph-app-'));const v={image:join(active.dir,'h-volume.sparseimage'),mountpoint:join(active.dir,'mounted-h'),home:join(active.dir,'mounted-h/home'),movesLog:join(active.dir,'native-volume-moves.jsonl'),mounted:false};active.volume=v;await mkdir(v.mountpoint);await writeFile(v.movesLog,'',{flag:'wx',mode:0o600});
 v.create=execFileSync('/usr/bin/hdiutil',['create','-size','128m','-fs','APFS','-type','SPARSE','-nospotlight','-volname','WillYouM10Graph',v.image],{encoding:'utf8',timeout:45000});v.attach=execFileSync('/usr/bin/hdiutil',['attach',v.image,'-nobrowse','-noautoopen','-owners','on','-mountpoint',v.mountpoint,'-plist'],{encoding:'utf8',timeout:45000});v.mounted=true;await mkdir(v.home,{mode:0o700});v.homeIdentity=identity(await lstat(v.home));v.cParentIdentity=identity(await lstat(active.dir));assert.notEqual(v.homeIdentity.dev,v.cParentIdentity.dev);
 const source=join(v.home,'MZ-cross-device-canary'),target=join(active.dir,'MZ-cross-device-canary'),bytes=Buffer.from('MZ only private cross-filesystem canary '+active.mode+'\n');await writeFile(source,bytes,{flag:'wx',mode:0o600});v.canary={source,target,before:identity(await lstat(source)),sha256:sha(bytes)};
 try{await rename(source,target);assert.fail('Cross-filesystem rename unexpectedly succeeded');}catch(error){assert.equal(error.code,'EXDEV');v.canary.errorCode=error.code;v.canary.errno=error.errno;}
 assert.deepEqual(await readFile(source),bytes);assert.deepEqual(identity(await lstat(source)),v.canary.before);v.canary.retainedAfterNaturalEXDEV=true;return v.home;
}
export async function observeGraphVolume(app,active,{userData,home}){
 if(!active.volume)return;const file=active.volume.movesLog;
 await app.mainEvaluate(`(()=>{const fs=process.getBuiltinModule('fs'),cp=process.getBuiltinModule('child_process'),path=process.getBuiltinModule('path'),g={exec:cp.execFileSync};if(globalThis.__m10GraphVolume)throw Error('Observer already installed');globalThis.__m10GraphVolume=g;const roots=[${JSON.stringify(home)},${JSON.stringify(join(userData,'capabilities'))}];const id=p=>{try{const s=fs.lstatSync(p);return{dev:s.dev,ino:s.ino,mode:s.mode&511,symlink:s.isSymbolicLink()};}catch(e){if(e.code==='ENOENT')return null;throw e;}},parent=p=>{let a=path.dirname(p);for(;;){const value=id(a);if(value)return{path:a,...value};const next=path.dirname(a);if(next===a)throw Error('Missing parent');a=next;}};cp.execFileSync=function(file,args,options){if(!(Array.isArray(args)&&['--move-discovery-directory','--restore-owned-directory'].includes(args[0])&&roots.includes(args[1])))return g.exec.apply(this,arguments);const from=path.join(args[1],args[2]),to=path.join(args[1],args[3]),entry={at:new Date().toISOString(),pid:process.pid,method:args[0],anchor:args[1],from,to,before:id(from),targetParent:parent(to)};try{const value=g.exec.apply(this,arguments);entry.after=id(to);entry.result=String(value);return value;}catch(e){entry.error={code:e.code??null};throw e;}finally{fs.appendFileSync(${JSON.stringify(file)},JSON.stringify(entry)+'\\n');}};return true})()`,{label:'mz-own-native-move-observer'});
}
export async function restoreGraphVolumeObserver(app,active){
 if(!active.volume)return;await app.mainEvaluate("(()=>{const g=globalThis.__m10GraphVolume;if(g){process.getBuiltinModule('child_process').execFileSync=g.exec;delete globalThis.__m10GraphVolume;}return true})()",{label:'mz-restore-own-move-observer'});
}
export async function finishGraphVolume(active,{home,userData}){
 const v=active.volume;if(!v)return;v.moves=(await readFile(v.movesLog,'utf8')).trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));assert(v.moves.length>0);const expectedDev={H:v.homeIdentity.dev,C:(await stat(join(userData,'capabilities'))).dev};assert.notEqual(expectedDev.H,expectedDev.C);v.expectedDev=expectedDev;
 for(const m of v.moves){const scope=m.anchor===home?'H':'C';assert.equal(m.anchor,scope==='H'?home:join(userData,'capabilities'));assert(m.before&&!m.before.symlink&&!m.targetParent.symlink);assert.equal(m.before.dev,expectedDev[scope]);assert.equal(m.targetParent.dev,expectedDev[scope]);assert(m.after);assert.equal(m.after.dev,m.before.dev);assert.equal(m.after.ino,m.before.ino);assert(!m.error);const response=JSON.parse(m.result);assert(response.restored);assert(m.from.startsWith(m.anchor+'/')&&m.to.startsWith(m.anchor+'/'));assert([m.from,m.to].some(p=>p.startsWith(join(m.anchor,scope==='H'?'.agents/smartdd-runtime/trash':'trash')+'/')));}
 assert(v.moves.some(m=>m.anchor===home));if(!active.mode.includes('crash'))assert(v.moves.some(m=>m.anchor===join(userData,'capabilities')));assert.equal(sha(await readFile(v.canary.source)),v.canary.sha256);assert.deepEqual(identity(await lstat(v.canary.source)),v.canary.before);v.canary.retainedAtEnd=true;v.verifiedBeforeDetach=true;
}
export async function detachGraphVolume(active){
 const v=active?.volume;if(!v?.mounted)return;v.detach=execFileSync('/usr/bin/hdiutil',['detach',v.mountpoint],{encoding:'utf8',timeout:30000});v.mounted=false;v.detached=true;v.imageSha256=sha(await readFile(v.image));v.imageBytes=(await stat(v.image)).size;v.finishedAt=new Date().toISOString();
}
