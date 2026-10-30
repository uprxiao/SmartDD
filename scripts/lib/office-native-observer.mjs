// Own-App passive native-process observation. Original spawn/stdin/results are
// forwarded unchanged. Live owned broker/vendor processes are sampled after9s;
// explicit diagnostic overhead, never an unmodified performance measurement.
export async function installOfficeNativeObserver(app, output) {
 return app.mainEvaluate('('+function(output){
  const cp=process.getBuiltinModule('child_process'),fs=process.getBuiltinModule('fs'),path=process.getBuiltinModule('path'),crypto=process.getBuiltinModule('crypto'),hash=value=>crypto.createHash('sha256').update(value).digest('hex');
  fs.mkdirSync(output,{recursive:true});
  const s={original:cp.spawn,rows:[],pending:new Set()};globalThis.__officeNativeObserver=s;
  const exec=(command,args)=>new Promise((resolve,reject)=>cp.execFile(command,args,{timeout:8000,maxBuffer:1024*1024},(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})));
  cp.spawn=function(...args){
   const child=s.original.apply(this,args);if(!String(args[0]).endsWith('/native/willyou-files'))return child;
   const originalEnd=child.stdin.end,row={pid:child.pid,command:args[0],at:Date.now(),closed:false,frames:[]};s.rows.push(row);let timer,text='';
   const data=bytes=>{text+=bytes.toString();let at;while((at=text.indexOf('\n'))>=0){const line=text.slice(0,at);text=text.slice(at+1);try{const message=JSON.parse(line);if(message.error)row.frames.push({error:message.error});else if(message.result)row.frames.push({state:message.result.state,hash:message.result.hash,bytes:message.result.bytes,pages:message.result.pages,...(typeof message.result.diagnostic==='string'?{diagnostic:message.result.diagnostic.slice(-65536)}:{})});}catch{}}};child.stdout.on('data',data);
   child.stdin.end=function(bytes,...rest){
    const before=hash(bytes),result=originalEnd.call(this,bytes,...rest);row.stdinUnchanged=before===hash(bytes);
    try{const input=JSON.parse(String(bytes));row.operation=input.operation;if(input.operation==='office-render'){
     row.format=input.format;row.inputHash=input.hash;row.job=input.job;
     timer=setTimeout(()=>{
      const parentWork=(async()=>{try{
       if(row.closed)return;const live=await exec('/bin/ps',['-p',String(row.pid),'-o','ppid=,comm=']),match=/^(\d+)\s+(.+)$/.exec(live.stdout.trim());if(!match||Number(match[1])!==process.pid||match[2]!==row.command)return;
       row.parentSample={pid:row.pid,parent:process.pid,executable:match[2],at:Date.now(),ms:Date.now()-row.at,file:path.join(output,'broker-'+row.pid+'.txt')};
       const result=await exec('/usr/bin/sample',[String(row.pid),'2','1','-file',row.parentSample.file]);Object.assign(row.parentSample,{finishedAt:Date.now(),stdout:result.stdout,stderr:result.stderr});
      }catch(error){row.parentSampleError=String(error);}})();s.pending.add(parentWork);void parentWork.finally(()=>s.pending.delete(parentWork));
      const work=(async()=>{try{
       if(row.closed)return;const owner=await exec('/bin/ps',['-p',String(row.pid),'-o','ppid=,pgid=,comm=']),owned=/^(\d+)\s+(\d+)\s+(.+)$/.exec(owner.stdout.trim());if(!owned||Number(owned[1])!==process.pid||Number(owned[2])!==row.pid||owned[3]!==row.command)return;
       // The macOS launcher can exit while a reparented vendor process still
       // owns its pipes. The broker's verified private process group, also
       // used by its original budget/cleanup code, retains that ownership.
       const ownerRoot=fs.realpathSync(path.dirname(output)),jobPath=fs.realpathSync(row.job.path);
       if(!jobPath.startsWith(ownerRoot+path.sep))throw Error('Diagnostic job is outside this own test directory');
       const out=path.join(jobPath,'out'),outStat=fs.lstatSync(out);if(!outStat.isDirectory()||outStat.isSymbolicLink())throw Error('Unexpected private render output directory');
       row.jobSnapshot={at:Date.now(),files:fs.readdirSync(out).slice(0,8).map(name=>{const p=path.join(out,name),stat=fs.lstatSync(p);return{name,bytes:stat.size,regular:stat.isFile(),symlink:stat.isSymbolicLink()};})};
       const listed=await exec('/usr/bin/pgrep',['-g',String(row.pid)]),vendor=path.join(path.dirname(row.command),'libreoffice/LibreOffice.app/Contents/MacOS/soffice');row.ownedGroupMembers=[];
       const candidates=new Set(listed.stdout.trim().split(/\s+/).map(Number).filter(n=>n>0));
       // A vendor restart may reparent or change its group. Match only this
       // already-validated private job token, then verify the pinned executable
       // and full args again; never inspect an unrelated vendor/daily process.
       if(!/^\/private\/tmp\/[A-Za-z0-9_./-]+$/.test(jobPath))throw Error('Unsupported diagnostic job token');
       try{const scoped=await exec('/usr/bin/pgrep',['-f',jobPath.replaceAll('.','[.]')]);for(const pid of scoped.stdout.trim().split(/\s+/).map(Number).filter(n=>n>0))candidates.add(pid);}catch{}
       for(const pid of candidates){
        let live;try{live=await exec('/bin/ps',['-p',String(pid),'-o','ppid=,pgid=,comm=']);}catch{continue;}const match=/^(\d+)\s+(\d+)\s+(.+)$/.exec(live.stdout.trim());if(!match)continue;
        const groupMatches=Number(match[2])===row.pid;
        if(groupMatches)row.ownedGroupMembers.push({pid,parent:Number(match[1]),group:Number(match[2]),executable:match[3]});if(match[3]!==vendor)continue;
        const args=(await exec('/bin/ps',['-ww','-p',String(pid),'-o','args='])).stdout,jobTokenMatches=args.includes(jobPath);if(!groupMatches&&!jobTokenMatches)continue;
        row.vendorArgumentProof={pid,groupMatches,actualGroup:Number(match[2]),jobTokenMatches,argvSha256:hash(args),ignoreStateArgument:args.includes('-ApplePersistenceIgnoreState')};
        row.sample={pid,parent:Number(match[1]),...(groupMatches?{ownedGroup:row.pid}:{}),actualGroup:Number(match[2]),ownership:groupMatches?'verified-private-group+pinned-executable':'exact-private-job-argv+pinned-executable',executable:match[3],at:Date.now(),ms:Date.now()-row.at,file:path.join(output,'native-'+row.pid+'-'+pid+'.txt')};
        const result=await exec('/usr/bin/sample',[String(pid),'2','1','-file',row.sample.file]);Object.assign(row.sample,{finishedAt:Date.now(),stdout:result.stdout,stderr:result.stderr});return;
       }
      }catch(error){row.sampleError=String(error);}})();s.pending.add(work);void work.finally(()=>s.pending.delete(work));
     },9000);
    }}catch{}
    return result;
   };
   row.restore=()=>{clearTimeout(timer);child.stdin.end=originalEnd;child.stdout.off('data',data);return child.stdin.end===originalEnd;};
   child.once('close',(code,signal)=>{row.closed=true;row.code=code;row.signal=signal;row.closedAt=Date.now();clearTimeout(timer);});return child;
  };
  process.getBuiltinModule('module').syncBuiltinESMExports();return true;
 }.toString()+')('+JSON.stringify(output)+')');
}
export const observeOfficeNative = app=>app.mainEvaluate('globalThis.__officeNativeObserver.rows.map(({restore,...row})=>row)');
export const restoreOfficeNativeObserver = app=>app.mainEvaluate('('+async function(){const s=globalThis.__officeNativeObserver;await Promise.allSettled([...s.pending]);const terminals=s.rows.map(row=>row.restore());const cp=process.getBuiltinModule('child_process');cp.spawn=s.original;process.getBuiltinModule('module').syncBuiltinESMExports();const result={spawnRestored:cp.spawn===s.original,streamsRestored:terminals,rows:s.rows.map(({restore,...row})=>row)};delete globalThis.__officeNativeObserver;return result;}.toString()+')()');
