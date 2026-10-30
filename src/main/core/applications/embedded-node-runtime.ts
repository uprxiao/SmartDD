import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {ApplicationError} from '@shared/applications';

/** Probe only this host's embedded runtime. No bootstrap, business authority,
 * inherited credentials, NODE_OPTIONS or PATH-selected runtime is involved. */
export class EmbeddedNodeRuntime {
 private ready=false;
 constructor(private readonly options:{executable?:string;timeoutMs?:number}={}){}
 async check(signal:AbortSignal):Promise<boolean>{
  if(signal.aborted)throw new ApplicationError('CANCELED','应用运行时检查已取消');
  if(this.ready)return true;
  const marker=randomBytes(24).toString('hex');
  const code=`if(typeof process.type!=='undefined'||typeof require('node:fs').readFileSync!=='function')process.exit(1);process.stdout.write(JSON.stringify({marker:${JSON.stringify(marker)},node:process.versions.node,electron:process.versions.electron??null}));`;
  const ready=await new Promise<boolean>((resolve,reject)=>{
   const child=(()=>{try{return spawn(this.options.executable??process.execPath,['-e',code],{env:{ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});}catch{return null;}})();
   if(!child){resolve(false);return;}
   let stdout='',bytes=0,failed=false,aborted=false;
   const stop=()=>{failed=true;child.kill('SIGKILL');};
   const abort=()=>{aborted=true;stop();};
   const timer=setTimeout(stop,this.options.timeoutMs??5000);
   signal.addEventListener('abort',abort,{once:true});
   if(signal.aborted)abort();
   child.on('error',()=>{failed=true;});
   child.stdout.on('data',(data:Buffer)=>{bytes+=data.length;if(bytes>4096)stop();else stdout+=data.toString('utf8');});
   child.stderr.on('data',(data:Buffer)=>{bytes+=data.length;if(bytes>4096)stop();});
   // Settle only after the owned process exits and its pipes close. A timeout
   // or cancel must not publish success while a probe process is still alive.
   child.once('close',(exitCode,exitSignal)=>{
    clearTimeout(timer);signal.removeEventListener('abort',abort);
    if(aborted){reject(new ApplicationError('CANCELED','应用运行时检查已取消'));return;}
    let verified=false;
    if(!failed&&exitCode===0&&!exitSignal)try{const value=JSON.parse(stdout);verified=value.marker===marker&&value.node===process.versions.node&&value.electron===(process.versions.electron??null);}catch{/* Invalid/missing result is unavailable. */}
    resolve(verified);
   });
  });
  // Successful checks are stable for this immutable executable/host lifetime;
  // failures remain retryable after environment repair.
  if(ready)this.ready=true;
  return ready;
 }
}
