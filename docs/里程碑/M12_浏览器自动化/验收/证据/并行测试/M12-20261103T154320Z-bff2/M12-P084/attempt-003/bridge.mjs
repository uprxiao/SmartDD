import assert from'node:assert/strict';import{spawn}from'node:child_process';import{createInterface}from'node:readline';import{ROOT,save}from'./io.mjs';
export async function boundedChild(program,args,{timeout=120000,env,recordPid}={}){
 const child=spawn(program,args,{cwd:ROOT,env,detached:true,stdio:['ignore','pipe','pipe']});recordPid?.(child.pid);let stdout='',stderr='',timedOut=false,alive=true;const signals=[];
 const stopOwnGroup=signal=>{if(alive&&Number.isSafeInteger(child.pid)){signals.push(signal);try{process.kill(-child.pid,signal)}catch(e){if(e.code!=='ESRCH')child.kill(signal)}}};
 child.stdout.on('data',b=>{stdout+=b;if(stdout.length>4*1024*1024){timedOut=true;stopOwnGroup('SIGTERM')}});child.stderr.on('data',b=>{stderr+=b;if(stderr.length>4*1024*1024){timedOut=true;stopOwnGroup('SIGTERM')}});
 const timer=setTimeout(()=>{timedOut=true;stopOwnGroup('SIGTERM')},timeout),kill=setTimeout(()=>stopOwnGroup('SIGKILL'),timeout+5000);let startError;
 child.once('error',e=>{startError={code:e.code??null,message:'Child process could not start'}});
 const exit=await new Promise(ok=>child.once('close',(code,signal)=>{alive=false;ok({code,signal})}));clearTimeout(timer);clearTimeout(kill);
 return{pid:child.pid??null,processGroup:child.pid??null,program,args,...exit,timedOut,signals,stdout,stderr,startError:startError??null};
}
export function startGeneralBridge(binary,{onSafeEvent,recordPid}={}){
 const child=spawn(binary,['--general','--backup',ROOT+'/runtime-001/clipboard-original.private.json'],{cwd:ROOT,stdio:['pipe','pipe','pipe']});recordPid?.(child.pid);let serial=0,ended=false;const rows=[],pending=new Map(),privateErrors=[];
 child.stderr.on('data',b=>privateErrors.push(b));
 const rejectPending=()=>{for(const [,p]of pending){clearTimeout(p.timer);p.no(Error('Clipboard bridge closed; original recovery remains private'))}pending.clear()};
 const closed=new Promise(ok=>child.once('close',(code,signal)=>{ended=true;rejectPending();ok({pid:child.pid,code,signal})}));
 child.once('error',()=>{ended=true;rejectPending()});child.stdin.on('error',rejectPending);
 const lines=createInterface({input:child.stdout});lines.on('line',line=>{try{const value=JSON.parse(line);rows.push({at:new Date().toISOString(),...value});onSafeEvent?.(rows.at(-1));const p=pending.get(value.id);if(p){clearTimeout(p.timer);pending.delete(value.id);p.ok(value)}}catch{child.kill('SIGTERM')}});
 async function request(op,fields={}){assert(!ended,'Clipboard bridge already closed');const id='req-'+(++serial),promise=new Promise((ok,no)=>{pending.set(id,{ok,no,timer:setTimeout(()=>{pending.delete(id);no(Error('Clipboard bridge bounded response timeout'))},15000)})});child.stdin.write(JSON.stringify({id,op,...fields})+'\n');const value=await promise;assert.equal(value.ok,true,'Clipboard bridge refused: '+(value.errorCode??'unknown'));return value}
 return{child,rows,closed,request,isEnded:()=>ended,async finishOrDefer(){child.stdin.end();let timer;const result=await Promise.race([closed,new Promise(ok=>{timer=setTimeout(()=>{child.kill('SIGTERM');ok(null)},20000)})]);clearTimeout(timer);if(result)return result;let hard;const exit=await Promise.race([closed,new Promise(ok=>{hard=setTimeout(()=>{child.kill('SIGKILL');ok(null)},5000)})]);clearTimeout(hard);return exit??await closed},privateErrors,closeReader:()=>lines.close()};
}
