// Test-only native faults: bounded own volume and a transparent native relay.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, stat, statfs, unlink, writeFile } from 'node:fs/promises';
import { closeSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
const exec=promisify(execFile),sha=x=>createHash('sha256').update(x).digest('hex');
export async function createSaveFailureFixture(broker){
 const base=await mkdtemp('/private/tmp/willyou-native-save-failure-'),volume=join(base,'volume'),project=join(volume,'project'),image=join(base,'fault-volume.dmg'),control=join(base,'fault-mode'),trace=join(base,'native-relay.jsonl'),original=join(base,'original-willyou-files'),wrapper=join(base,'willyou-files-relay');
 const evidence={at:new Date().toISOString(),base,volume,project,image,commands:[],boundary:'Own64MiB APFS image only; actual parent permission removal, actual native ENOSPC/capacity guard, actual native EFBIG from4096-byte RLIMIT_FSIZE on save only. Relay forwards original requests and newline frames byte-identically, never fabricates responses. userData/drafts remain outside full volume.'};let device,mountedDevice,closed=false,pressure=null;
 async function command(args,options={}){try{const r=await exec(args[0],args.slice(1),{timeout:45000,maxBuffer:8*1024*1024,...options});evidence.commands.push({args,code:0,stderr:r.stderr});return r.stdout;}catch(error){evidence.commands.push({args,code:error.code,stderr:error.stderr});throw error;}}
 async function stopPressure(){if(!pressure)return;const current=pressure;current.active=false;await current.pump;closeSync(current.fd);pressure=null;}
 async function close(){if(closed)return;await stopPressure();await chmod(project,0o700).catch(()=>{});if(device){assert.equal((await stat(volume)).dev,mountedDevice,'Own volume identity changed');await command(['hdiutil','detach',device]);evidence.detached=true;}closed=true;evidence.finishedAt=new Date().toISOString();await writeFile(join(base,'environment.json'),JSON.stringify(evidence,null,2)+'\n');}
 try{
  await mkdir(volume);await command(['hdiutil','create','-size','64m','-fs','APFS','-volname','WillYou-Save-Failure','-type','UDIF',image]);
  const plist=await command(['hdiutil','attach','-nobrowse','-noautoopen','-mountpoint',volume,'-plist',image]);await writeFile(join(base,'attach.plist'),plist);
  const parsed=JSON.parse(await command(['/usr/bin/python3','-c','import json,plistlib,sys;print(json.dumps(plistlib.load(open(sys.argv[1],"rb"))))',join(base,'attach.plist')]));
  device=parsed['system-entities'].find(x=>x['mount-point']===volume)?.['dev-entry'];assert(device&&/^\/dev\/disk\d+s\d+$/.test(device));mountedDevice=(await stat(volume)).dev;assert.notEqual(mountedDevice,(await stat(base)).dev);
  const fs=await statfs(volume);assert(fs.blocks*fs.bsize<=80*1024*1024);evidence.capacityBytes=fs.blocks*fs.bsize;evidence.device=device;await mkdir(project,{mode:0o700});await writeFile(control,'normal');await copyFile(broker,original);await chmod(original,0o755);evidence.originalBrokerSha256=sha(await readFile(original));assert.equal(evidence.originalBrokerSha256,sha(await readFile(broker)));
  const source=`#!/usr/bin/python3
import hashlib,json,os,resource,signal,subprocess,sys,time
payload=sys.stdin.buffer.read()
request=json.loads(payload)
fault=open(${JSON.stringify(control)}).read().strip()=='generic' and request.get('operation')=='save'
def limit():
 signal.signal(signal.SIGXFSZ,signal.SIG_IGN)
 resource.setrlimit(resource.RLIMIT_FSIZE,(4096,4096))
p=subprocess.Popen([${JSON.stringify(original)}]+sys.argv[1:],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=sys.stderr.buffer,preexec_fn=limit if fault else None)
p.stdin.write(payload);p.stdin.close()
frames=[]
recovery_path=(request.get('recoveryRoot') or {}).get('path')
for line in p.stdout:
 sys.stdout.buffer.write(line);sys.stdout.buffer.flush()
 frame={'sha256':hashlib.sha256(line).hexdigest(),'bytes':len(line)}
 try:
  value=json.loads(line)
  if request.get('operation')=='initialize-recovery' and isinstance(value.get('result'),dict):recovery_path=value['result'].get('path')
  if 'error' in value:frame['nativeError']=value['error']
  if isinstance(value.get('result'),dict) and 'state' in value['result']:frame['nativeReceipt']={k:value['result'][k] for k in ['state','message','opId','recoveryId'] if k in value['result']}
 except Exception:pass
 frames.append(frame)
code=p.wait()
# Save/copy run under the production kernel write scope. Keep this explicit
# test-only telemetry inside its already authorized private recovery root.
log_path=os.path.join(recovery_path,'.willyou-test-native-relay.jsonl') if request.get('operation') in ('save','copy') and recovery_path else ${JSON.stringify(trace)}
with open(log_path,'a') as log:
 log.write(json.dumps({'at':time.time(),'operation':request.get('operation'),'relativePath':request.get('relativePath'),'requestSha256':hashlib.sha256(payload).hexdigest(),'saveFsizeLimit':4096 if fault else None,'nativeExit':code,'frames':frames,'recoveryPath':recovery_path,'tracePath':log_path})+'\\n')
sys.exit(code)
`;
  await writeFile(wrapper,source,{mode:0o755});evidence.wrapperSha256=sha(Buffer.from(source));
  const filler=join(volume,'space-filler');
  async function clear(){await stopPressure();await writeFile(control,'normal');await chmod(project,0o700);await unlink(filler).catch(error=>{if(error.code!=='ENOENT')throw error;});const end=Date.now()+5000;for(;;){const fs=await statfs(volume);if(fs.bavail*fs.bsize>512*1024)break;assert(Date.now()<end,'Own APFS space release did not settle');await delay(20);}}
  async function activate(mode){
   await clear();if(mode==='permission'){await chmod(project,0o500);return{mode,actualParentMode:'0500'};}if(mode==='generic'){await writeFile(control,'generic');return{mode,actualRlimitFsize:4096,nativeErrorExpected:'EFBIG'};}
   assert.equal(mode,'disk-full');assert.equal((await stat(volume)).dev,mountedDevice);
   const fd=openSync(filler,'wx'),chunk=Buffer.alloc(4096,120),stats={mode,writtenBytes:0,enospcCount:0,lastEnospcAt:0,actualError:null,backgroundPressure:true};
   const fill=()=>{try{for(;;){const n=writeSync(fd,chunk);assert(n>0);stats.writtenBytes+=n;assert(stats.writtenBytes<=80*1024*1024,'Refusing to fill a larger filesystem');}}catch(error){assert.equal(error.code,'ENOSPC');stats.enospcCount++;stats.lastEnospcAt=Date.now();stats.actualError={code:error.code,errno:error.errno,message:error.message};}};
   fill();const current={fd,active:true,pump:null};pressure=current;
   // APFS can release blocks from an earlier unlinked filler asynchronously.
   // Keep real write pressure throughout native save, rather than claiming a
   // one-time ENOSPC guarantees that capacity remains exhausted later.
   current.pump=(async()=>{while(current.active){await delay(1);if(current.active)fill();}})();return stats;
  }
  async function cloneApp(app){const copy=join(base,'WillYou-Fault-Test.app');await command(['/bin/cp','-cR',app,copy]);const target=join(copy,'Contents/Resources/native/willyou-files');await writeFile(target,source);await chmod(target,0o755);assert.equal(sha(await readFile(broker)),evidence.originalBrokerSha256);evidence.privateApp={path:copy,wrapperSha256:sha(await readFile(target)),originalSourceApp:app};return copy;}
  const observations=async()=>{
   let rows=[];try{rows=(await readFile(trace,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code!=='ENOENT')throw error;}
   const paths=[...new Set(rows.filter(row=>row.operation==='initialize-recovery'&&row.recoveryPath).map(row=>join(row.recoveryPath,'.willyou-test-native-relay.jsonl')))];
   for(const path of paths){assert(path.startsWith('/private/tmp/')&&path.includes('/file-recovery/v1/'),'Relay trace is not inside an own temporary recovery root');try{rows.push(...(await readFile(path,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)));}catch(error){if(error.code!=='ENOENT')throw error;}}
   return rows.sort((a,b)=>a.at-b.at);
  };
  return{base,volume,project,wrapper,original,control,trace,evidence,activate,clear,cloneApp,observations,close};
 }catch(error){await close().catch(cleanup=>{evidence.cleanupError=String(cleanup);});await writeFile(join(base,'environment.json'),JSON.stringify({...evidence,error:String(error)},null,2)+'\n');throw error;}
}
