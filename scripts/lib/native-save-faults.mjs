// Own-App native timing fixture. Never changes production requests or replies.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const sha=x=>createHash('sha256').update(x).digest('hex');
export async function createPrivateSaveFaultApp(sourceApp,base){
 const marker=join(base,'native-save-stop'),original=await readFile('native/files/broker.mm','utf8'),guard='if ([request[@"testStopAt"] isEqual:phase])';assert.equal(original.split(guard).length,2);
 const check='[[NSString stringWithContentsOfFile:@'+JSON.stringify(marker)+' encoding:NSUTF8StringEncoding error:nil] isEqual:[NSString stringWithFormat:@"%@\\n%@", phase, request[@"relativePath"]]]';
 const injected=original.replace(guard,'if ([request[@"testStopAt"] isEqual:phase] || '+check+')'),testSource=join(base,'broker-test.mm'),helper=join(base,'willyou-files-test');await writeFile(testSource,injected);
 const args=['clang++','-std=c++17','-fobjc-arc','-O1','-Wno-deprecated-declarations','-DWILLYOU_FILE_BROKER_TEST=1','-I',resolve('native/files'),'-framework','Foundation','-framework','AppKit','-framework','ImageIO','-framework','CoreGraphics','-framework','CoreText',testSource,'-o',helper];execFileSync('xcrun',args,{encoding:'utf8'});
 const app=join(base,'WillYou-Save-Fault.app');execFileSync('/bin/cp',['-cR',sourceApp,app]);await writeFile(join(app,'Contents/Resources/native/willyou-files'),await readFile(helper));const asar=sha(await readFile(join(app,'Contents/Resources/app.asar')));assert.equal(asar,sha(await readFile(join(sourceApp,'Contents/Resources/app.asar'))));
 return{app,marker,testSource,helper,asarSha256:asar,sourceSha256:sha(original),testSourceSha256:sha(injected),helperSha256:sha(await readFile(helper)),compile:['xcrun',...args],boundary:'Private COW clone, original ASAR/auth/requests/results. Same native source with existing TEST stop condition augmented only by own read-only marker. Current production launch/write policy unchanged.'};
}
export const markNativeSave=(fault,phase,relative)=>writeFile(fault.marker,phase+'\n'+relative);
export async function clearNativeSave(fault){try{await unlink(fault.marker);}catch(error){if(error.code!=='ENOENT')throw error;}}
export async function installNativeSaveTrace(app){
 return app.mainEvaluate("("+function(){const m=process.getBuiltinModule('child_process'),s={original:m.spawn,rows:[]};globalThis.__nativeSaveTrace=s;m.spawn=function(...args){const child=s.original.apply(this,args);if(args[0]==='/usr/bin/sandbox-exec'){const row={command:args[0],args:args[1],pid:child.pid,frames:[],closed:false};s.rows.push(row);let text='';const data=b=>{text+=b;let at;while((at=text.indexOf('\n'))>=0){const line=text.slice(0,at);text=text.slice(at+1);try{row.frames.push(JSON.parse(line))}catch{}}};child.stdout.on('data',data);child.once('close',(code,signal)=>{row.closed=true;row.code=code;row.signal=signal;child.stdout.off('data',data)});}return child;};process.getBuiltinModule('module').syncBuiltinESMExports();return true;}.toString()+")()");
}
export const nativeSaveTrace=app=>app.mainEvaluate('globalThis.__nativeSaveTrace.rows');
export async function restoreNativeSaveTrace(app){return app.mainEvaluate("("+function(){const m=process.getBuiltinModule('child_process'),s=globalThis.__nativeSaveTrace;m.spawn=s.original;process.getBuiltinModule('module').syncBuiltinESMExports();const out={restored:m.spawn===s.original,rows:s.rows};delete globalThis.__nativeSaveTrace;return out;}.toString()+")()");}
export async function installWatchDeliveryGate(app){
 return app.mainEvaluate("("+function(){const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),wc=e.BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:')).webContents,s={wc,original:wc.send,hold:false,rows:[]},hash=x=>process.getBuiltinModule('crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');globalThis.__saveWatchGate=s;wc.send=function(channel,value,...args){if(channel!=='files:watch')return s.original.call(this,channel,value,...args);const row={at:Date.now(),channel,value,args,before:hash(value),waiting:s.hold,delivered:false};s.rows.push(row);if(!s.hold){s.original.call(this,channel,value,...args);row.after=hash(value);row.delivered=true;}return undefined;};return true;}.toString()+")()");
}
export const holdWatchDelivery=app=>app.mainEvaluate('(()=>{globalThis.__saveWatchGate.hold=true;return true})()');
export const watchDeliveryTrace=app=>app.mainEvaluate('globalThis.__saveWatchGate.rows');
export async function releaseWatchDelivery(app){return app.mainEvaluate("("+function(){const s=globalThis.__saveWatchGate,hash=x=>process.getBuiltinModule('crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');s.hold=false;for(const row of s.rows)if(row.waiting){if(hash(row.value)!==row.before)throw Error('Original watch changed while held');s.original.call(s.wc,row.channel,row.value,...row.args);row.after=hash(row.value);row.waiting=false;row.delivered=true;}return true;}.toString()+")()");}
export async function restoreWatchDelivery(app){await releaseWatchDelivery(app);return app.mainEvaluate("("+function(){const s=globalThis.__saveWatchGate;s.wc.send=s.original;const out={restored:s.wc.send===s.original,rows:s.rows};delete globalThis.__saveWatchGate;return out;}.toString()+")()");}
export function externalPathWriter(path,text){
 const script='import base64,json,os,sys; p=sys.argv[1]; b=base64.b64decode(sys.argv[2]); f=os.open(p,os.O_WRONLY|os.O_TRUNC); n=os.write(f,b); os.fsync(f); s=os.fstat(f); os.close(f); print(json.dumps({"pid":os.getpid(),"written":n,"device":str(s.st_dev),"inode":str(s.st_ino)}))';
 return JSON.parse(execFileSync('/usr/bin/python3',['-c',script,path,Buffer.from(text).toString('base64')],{encoding:'utf8'}));
}
