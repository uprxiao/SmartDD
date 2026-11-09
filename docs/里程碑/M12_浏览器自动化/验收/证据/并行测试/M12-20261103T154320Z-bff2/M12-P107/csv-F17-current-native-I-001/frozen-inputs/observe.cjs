// Process-local observation only; all original spawn/native-loader calls delegate unchanged.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),cp=require('node:child_process');
const root=process.env.M12_CSV_I_ROOT;if(!root||root!=='/private/tmp/willyou-m12-t130-native-remaining-prep-001/F17-native-I-001')throw Error('observer root mismatch');
const log=event=>fs.appendFileSync(path.join(root,'output',`process-${process.pid}.jsonl`),JSON.stringify({at:new Date().toISOString(),pid:process.pid,...event})+'\n');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
log({event:'process-start',ppid:process.ppid,execPath:process.execPath,cwd:process.cwd()});
const originalSpawn=cp.spawn;
cp.spawn=function(...args){const child=Reflect.apply(originalSpawn,this,args),executable=String(args[0]);log({event:'spawn',childPID:child.pid??null,executable,isExactBroker:executable===process.env.SMARTDD_FILES_NATIVE_PATH});child.on('error',e=>log({event:'child-error',childPID:child.pid??null,name:e.name,message:e.message}));child.on('close',(code,signal)=>log({event:'child-close',childPID:child.pid??null,code,signal}));return child;};
const nativeLoader=Module._extensions['.node'];
Module._extensions['.node']=function(module,filename){const before=hash(filename);const result=Reflect.apply(nativeLoader,this,arguments);log({event:'native-addon-loaded',filename:fs.realpathSync(filename),sha256:before});return result;};
Module.syncBuiltinESMExports();
process.on('exit',code=>log({event:'process-exit',code}));
