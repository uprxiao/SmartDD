// Proposed initial focus preparation only. Authorization is required before any AppleScript execution.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const runFile=promisify(execFile),sha=b=>createHash('sha256').update(b).digest('hex');
export async function activateInitialExactTestPid({app,pin,userData,privateRoot,authorization,scriptPath}){
 assert.equal(process.platform,'darwin');
 assert(authorization?.status==='explicitly-authorized'&&authorization.scope==='M12-isolated-initial-foreground-only'&&authorization.userMessageReference);
 assert.equal(privateRoot,'/private/tmp/willyou-m12-t145-final-host16-App051-retest-prep-001');assert(userData===privateRoot+'/runtime-001/userdata');
 assert(pin.executable.startsWith('/private/tmp/willyou-m12-')&&pin.executable.endsWith('/WillYou.app/Contents/MacOS/WillYou'));
 assert(Number.isInteger(app.processId)&&app.processId>1);
 const script=await readFile(scriptPath);assert.equal(sha(script),authorization.scriptSHA256);
 const actual=await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json')('electron');return{pid:process.pid,executable:process.execPath,userData:E.app.getPath('userData')};})()`,{label:'readonly-owned-initial-focus'});
 assert.deepEqual(actual,{pid:app.processId,executable:pin.executable,userData});
 const record={at:new Date().toISOString(),pid:app.processId,executable:pin.executable,userData,scope:authorization.scope,userAuthorization:authorization.userMessageReference,scriptSHA256:sha(script),attempts:1,guardNotInstalledYet:true};
 await writeFile(privateRoot+'/initial-foreground-attempt-'+app.processId+'.json',JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
 const bundle=pin.executable.slice(0,-'/Contents/MacOS/WillYou'.length);
 try{const result=await runFile('/usr/bin/osascript',[scriptPath,String(app.processId),'WillYou',bundle,pin.executable],{timeout:30000,maxBuffer:16384});assert.equal(result.stdout.trim(),'M12_INITIAL_FOREGROUND_ATTEMPTED_ONCE');return{...record,requestSent:true,focusSuccess:'unverified-until-real-Native-DOM-stable3s',stdout:result.stdout.trim()};}
 catch(error){return{...record,requestSent:false,focusSuccess:false,errorCode:error.code??null,errorSignal:error.signal??null,errorMessage:String(error.message).slice(0,500),noRetry:true};}
}
