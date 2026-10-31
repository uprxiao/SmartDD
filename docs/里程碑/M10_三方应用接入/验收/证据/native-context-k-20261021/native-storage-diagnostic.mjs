import {openElectron} from '/Users/liubu/Documents/ChatGPT/SmartDD-m10/scripts/lib/electron-harness.mjs';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
const scratch=await mkdtemp('/private/tmp/willyou-m10-native-storage-'),userData=join(scratch,'userdata'),result={schema:'m10-native-storage-diagnostic-v1',startedAt:new Date().toISOString(),scratch,userData,layer:'native backend diagnostic; not UI acceptance',marker:'non-business diagnostic only',dailyCredentials:false,acceptedSystemPermission:false};let app,timer,sampling;
try{
 app=await openElectron({executable:'/private/tmp/m10-native-context-k-package-20261021/mac-arm64/WillYou.app/Contents/MacOS/WillYou',userData,inspectMain:true});result.pid=app.processId;await app.evaluate("document.title='A · M10 · isolated native-storage diagnostic';true");
 await writeFile(join(scratch,'ready.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({ready:{scratch,pid:app.processId}}));
 const focused=await app.evaluate('document.hasFocus()');if(!focused){result.status='deferred-focus-loss';}else{
  result.nativeStartedAt=new Date().toISOString();timer=setTimeout(()=>{sampling=new Promise(resolve=>execFile('/usr/bin/sample',[String(app.processId),'1','1','-file',join(scratch,'main-sample.txt')],{timeout:5000},error=>{result.sample={success:!error,errorCode:error?.code??null};resolve();}));},3000);
  const native=app.mainEvaluate("(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'),marker='m10-native-storage-diagnostic-only',available=e.safeStorage.isEncryptionAvailable();if(!available)return{available:false};const ciphertext=e.safeStorage.encryptString(marker);return{available,roundtrip:e.safeStorage.decryptString(ciphertext)===marker,ciphertextBytes:ciphertext.length}})()").then(value=>({status:'returned',value}),error=>({status:'native-error',error:String(error)}));
  let bound;const timeout=new Promise(resolve=>bound=setTimeout(()=>resolve({status:'native-unresponsive',timeoutMs:12000}),12000));Object.assign(result,await Promise.race([native,timeout]));clearTimeout(bound);clearTimeout(timer);if(sampling)await sampling;
 }
}catch(error){result.status='diagnostic-error';result.error=String(error);}
finally{clearTimeout(timer);if(app){await writeFile(join(scratch,'electron.txt'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.status!=='returned')process.exitCode=2;}
