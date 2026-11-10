// Existing once-PID activation authorization;007 only refines the readonly exact-title precondition.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const runFile=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
export function activationIdentityExpression(id){return `(()=>{const E=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron'),w=E.BrowserWindow.fromId(${JSON.stringify(id)});return{pid:process.pid,executable:process.execPath,userData:E.app.getPath('userData'),window:w&&!w.isDestroyed()&&w.webContents.getURL().includes('/out/renderer/index.html')?{id:w.id,contentsId:w.webContents.id,title:w.getTitle()}:null};})()`;}
export function parseActivationReply(stdout,expectedTitle){
 const ax=JSON.parse(stdout.trim());assert.equal(ax.schema,'m12-exact-title-initial-activation-v1');assert.equal(typeof ax.activated,'boolean');assert(Array.isArray(ax.samples)&&ax.samples.length>0);
 for(const sample of ax.samples){assert(Number.isInteger(sample.totalWindows)&&sample.totalWindows>=0);assert(Number.isInteger(sample.matchedWindows)&&sample.matchedWindows>=0);assert(Array.isArray(sample.titles)&&sample.titles.every(t=>typeof t==='string'));assert.equal(sample.totalWindows,sample.titles.length);assert.equal(sample.matchedWindows,sample.titles.filter(t=>t===expectedTitle).length);}
 if(ax.activated){assert.equal(ax.reason,'exact-title-activated-once');assert.equal(ax.samples.at(-1).matchedWindows,1);}else assert(['exact-title-ambiguous-no-action','exact-title-timeout-no-action','exact-title-changed-no-action'].includes(ax.reason));return ax;
}
export async function activateInitialExactTestPid({app,mainWindow,pin,userData,privateRoot,authorization,scriptPath}){
 assert.equal(process.platform,'darwin');assert(authorization?.status==='explicitly-authorized'&&authorization.scope==='M12-isolated-initial-foreground-only'&&authorization.userMessageReference);
 assert(privateRoot.startsWith('/private/tmp/willyou-m11-r10-release013-'));assert.equal(userData,privateRoot+'/userdata');assert(pin.executable.startsWith('/private/tmp/willyou-m11-s7/')&&pin.executable.endsWith('/WillYou.app/Contents/MacOS/WillYou'));assert(Number.isInteger(app.processId)&&app.processId>1);
 assert(Number.isInteger(mainWindow?.id)&&Number.isInteger(mainWindow.contentsId)&&typeof mainWindow.title==='string'&&mainWindow.title.length>0);
 const script=await readFile(scriptPath);assert.equal(sha(script),authorization.scriptSHA256);
 const actual=await app.mainEvaluate(activationIdentityExpression(mainWindow.id),{label:'readonly-owned-initial-focus'});
 assert.deepEqual(actual,{pid:app.processId,executable:pin.executable,userData,window:{id:mainWindow.id,contentsId:mainWindow.contentsId,title:mainWindow.title}});
 const record={at:new Date().toISOString(),pid:app.processId,executable:pin.executable,userData,mainWindow:actual.window,scope:authorization.scope,userAuthorization:authorization.userMessageReference,scriptSHA256:sha(script),attempts:1,guardNotInstalledYet:true,axReadonlyWaitSeconds:8,execTimeoutMs:30000};
 const receipt=privateRoot+'/initial-foreground-attempt-'+app.processId+'.json';await writeFile(receipt,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
 const finish=async value=>{await writeFile(receipt,JSON.stringify(value,null,2)+'\n',{mode:0o600});return value;};
 const bundle=pin.executable.slice(0,-'/Contents/MacOS/WillYou'.length);
 try{
  const output=await runFile('/usr/bin/osascript',[scriptPath,String(app.processId),'WillYou',bundle,pin.executable,mainWindow.title],{timeout:30000,maxBuffer:262144});
  const ax=parseActivationReply(output.stdout,mainWindow.title);return finish({...record,requestSent:ax.activated,focusSuccess:ax.activated?'unverified-until-real-Native-DOM-stable3s':false,ax,stdout:output.stdout,stderr:output.stderr,noRetry:true});
 }catch(error){
  const stdout=String(error.stdout??''),stderr=String(error.stderr??''),observations=[];for(const match of stderr.matchAll(/M12_AX_WINDOW_OBSERVATION=(\{[^\n]*\})/g))try{observations.push(JSON.parse(match[1]));}catch{}
  return finish({...record,requestSent:null,focusSuccess:false,errorCode:error.code??null,errorSignal:error.signal??null,errorMessage:String(error.message).slice(0,500),stdout,stderr,axObservations:observations,actionMayHaveBeenSent:stderr.includes('M12_AX_ACTION_REQUESTED_ONCE'),noRetry:true});
 }
}
