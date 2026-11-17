// Host jobs (Git/worktree/package preparation) have real handles and an owned process group.
// A wrapper stays alive until descendants drain, so its birth can be verified before any command starts.
import { spawn } from 'node:child_process';
import type { ProcessIdentityReader, ProcessIdentity } from '../applications/process-identity';
import type { GitResult } from './git-workspaces';
export interface WorkspaceCommandOptions { signal?: AbortSignal; taskId?: string }
const wrapper = `
const {spawn}=require('node:child_process');let command,started=false;
process.on('message',m=>{
 if(m==='quit'&&!started)process.exit(0);
 if(m==='go'&&!started){started=true;try{command=spawn(process.argv[1],process.argv.slice(2),{stdio:['ignore','inherit','inherit']});command.once('error',()=>process.send?.({ended:true,code:-1}));command.once('exit',(code,signal)=>process.send?.({ended:true,code:code??-1,signal}));}catch{process.send?.({ended:true,code:-1});}}
 if(m==='cancel')command?.kill('SIGTERM');
 if(m==='release')process.exit(0);
});process.send?.({ready:true});
`;
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export function ownedWorkspaceCommand(d: {
  processes: ProcessIdentityReader; env(): Record<string,string>;
  blocked?(options:WorkspaceCommandOptions,proof:ProcessIdentity|undefined,detail:string):void;
}) {
  return async(cwd:string,command:string,args:readonly string[],timeoutMs=120_000,options:WorkspaceCommandOptions={}):Promise<GitResult> => {
    const child=spawn(process.execPath,['-e',wrapper,'--',command,...args],{cwd,env:{...d.env(),ELECTRON_RUN_AS_NODE:'1',GIT_TERMINAL_PROMPT:'0'},detached:process.platform!=='win32',stdio:['pipe','pipe','pipe','ipc']});
    let stdout='',stderr='',ended=false,code=-1,ready=false,exited=false,spawnFailed=false,root:ProcessIdentity|undefined,started=false;
    let stopAt=0,drainAt=0,notified=false,overflow=false;
    const append=(old:string,b:Buffer)=>{const next=old+b.toString('utf8');if(Buffer.byteLength(next)>8*1024*1024){overflow=true;return next.slice(-2*1024*1024);}return next;};
    child.stdout?.on('data',(b:Buffer)=>{stdout=append(stdout,b);});child.stderr?.on('data',(b:Buffer)=>{stderr=append(stderr,b);});
    child.on('message',(m:any)=>{if(m?.ready)ready=true;if(m?.ended){ended=true;code=Number.isInteger(m.code)?m.code:-1;}});
    child.once('error',()=>{spawnFailed=true;});child.once('exit',()=>{exited=true;});
    const send=(message:string)=>{if(child.connected)child.send(message,()=>{});};
    const opened=Date.now();
    // No project command is run before this exact wrapper's real birth is established.
    while(!ready&&!exited&&!spawnFailed&&Date.now()-opened<5000)await pause(10);
    if(ready&&child.pid)root=d.processes.read(child.pid)??undefined;
    if(!root||!d.processes.ownedGroup||!d.processes.ownedGroup(root)?.processes.some(p=>p.pid===root!.pid&&p.startedAt===root!.startedAt)||options.signal?.aborted||!ready){
      send('quit');while(!exited&&!spawnFailed)await pause(20);
      return{stdout,stderr:stderr+'\n宿主命令未启动：进程身份不可核实或准备已取消',code:-1};
    }
    send('go');started=true;
    const deadline=Date.now()+timeoutMs;
    while(true){
      const stop=!!options.signal?.aborted||Date.now()>=deadline||overflow;
      if(stop&&!stopAt){stopAt=Date.now();send('cancel');}
      let group:ReturnType<NonNullable<ProcessIdentityReader['ownedGroup']>>|undefined;
      try{group=d.processes.ownedGroup(root);}catch{/* Unknown is not permission to release. */}
      if(!group){
        if(!notified){notified=true;d.blocked?.(options,root,'命令或后代退出尚未核实，保留目录占用');}
        await pause(200);continue;
      }
      // The wrapper owns no project writes. After completion/cancel, stop only proven members of its group.
      if(ended||stop||exited){
        if(!drainAt)drainAt=Date.now();
        const others=group.processes.filter(p=>p.pid!==root!.pid);
        for(const p of others)if(d.processes.state(p)==='running')try{process.kill(p.pid,Date.now()-drainAt>2000?'SIGKILL':'SIGTERM');}catch{/* Independently observe next pass. */}
        if(!others.length){
          if(!exited){send('release');await pause(20);continue;}
          if(group.state==='stopped')break;
        }
      }
      if(exited&&!ended){ended=true;code=-1;}
      await pause(50);
    }
    if(!started||stopAt||overflow)code=-1;
    return{stdout,stderr:stderr+(options.signal?.aborted?'\n宿主准备已取消':stopAt?'\n宿主命令超时或输出超限':''),code};
  };
}
