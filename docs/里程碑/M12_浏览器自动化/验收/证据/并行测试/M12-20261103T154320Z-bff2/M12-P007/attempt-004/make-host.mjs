import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const root='/private/tmp/willyou-m12-t065-executor-001/attempt-004',base=process.env.T065_FROZEN_BASELINE;
assert(base?.startsWith('/private/tmp/willyou-m12-'),'Explicit new frozen baseline path is required');
let source=await readFile(base+'/scripts/browser/s1-service-host.ts','utf8');source=source.replaceAll("'../../src/", "'"+base+'/src/').replaceAll("'./popup-fixtures.mjs'", "'"+base+"/scripts/browser/popup-fixtures.mjs'").replaceAll("'./s3-fixtures.mjs'", "'"+base+"/scripts/browser/s3-fixtures.mjs'");
const trace=`
// T065 observation-only wrapper in private I fixture; each original is called unchanged.
import {BrowserHelper as T065Helper} from '${base}/src/main/core/browser/agent-browser';
import {BrowserCdpProxy as T065Proxy} from '${base}/src/main/core/browser/cdp-proxy';
import t065ChildProcess from 'node:child_process';
import {createHash as t065CreateHash} from 'node:crypto';
const t065Trace={helperCalls:[] as {at:number;session:string;args:string[]}[],proxyEvents:[] as unknown[],rawHelpers:[] as unknown[],restored:false};
const t065OriginalCommand=T065Helper.prototype.command,t065OriginalStart=T065Proxy.prototype.start;

const t065OriginalExecFile=t065ChildProcess.execFile;
Reflect.set(t065ChildProcess,'execFile',function(...args:any[]){
  const file=args[0],argv=args[1];
  if(file===process.env.M12_RESOURCE_ROOT+'/agent-browser/'+process.arch+'/agent-browser'&&Array.isArray(argv)&&argv.includes('batch')&&argv.includes('--json')&&typeof args.at(-1)==='function'){
    const originalCallback=args.at(-1),at=performance.now(),si=argv.indexOf('--session'),ci=argv.indexOf('--cdp'),session=si>=0?String(argv[si+1]):'',endpoint=ci>=0?String(argv[ci+1]):'';
    const redact=(v:unknown)=>{const text=String(v??'');if(!endpoint)return text;const result=text.split(endpoint).join('<page-cdp>');try{const token=new URL(endpoint).pathname.slice(1);return token?result.split(token).join('<page-cdp-token>'):result}catch{return result}};
    args[args.length-1]=function(this:unknown,error:any,stdout:any,stderr:any){
      const command=t065Trace.helperCalls.filter(call=>call.session===session).at(-1)?.args;
      t065Trace.rawHelpers.push({at,finishedAt:performance.now(),session,command,argv:argv.map((v,i)=>i===ci+1?'<page-cdp>':String(v)),stdout:redact(stdout),stderr:redact(stderr),stdoutSha256:t065CreateHash('sha256').update(Buffer.isBuffer(stdout)?stdout:Buffer.from(String(stdout??''))).digest('hex'),error:error?{code:error.code??null,signal:error.signal??null,killed:error.killed??false}:null,redactions:endpoint?['private page CDP capability URL']:[]});
      return originalCallback.call(this,error,stdout,stderr);
    };
  }
  return Reflect.apply(t065OriginalExecFile,t065ChildProcess,args);
});

const t065Instances=new Map<T065Proxy,(event:Record<string,unknown>)=>void>();
T065Helper.prototype.command=function(args,options){t065Trace.helperCalls.push({at:performance.now(),session:this.options.session,args:[...args]});return t065OriginalCommand.call(this,args,options)};
T065Proxy.prototype.start=function(){if(!t065Instances.has(this)){const original=Reflect.get(this,'trace') as (event:Record<string,unknown>)=>void;t065Instances.set(this,original);Reflect.set(this,'trace',(event:Record<string,unknown>)=>{t065Trace.proxyEvents.push({at:performance.now(),webContentsId:this.contents.id,...event});original(event)})}return t065OriginalStart.call(this)};
function t065Restore(){Reflect.set(t065ChildProcess,'execFile',t065OriginalExecFile);T065Helper.prototype.command=t065OriginalCommand;T065Proxy.prototype.start=t065OriginalStart;for(const [proxy,original]of t065Instances)Reflect.set(proxy,'trace',original);t065Trace.restored=true;return{restored:t065Trace.restored,helperPrototypeRestored:T065Helper.prototype.command===t065OriginalCommand,proxyPrototypeRestored:T065Proxy.prototype.start===t065OriginalStart,execFileRestored:t065ChildProcess.execFile===t065OriginalExecFile,instanceCount:t065Instances.size}}
`;
source=trace+source;
const original="if (message.command === 'cli') value = await launchCli";
if(!source.includes(original))throw Error('Frozen host CLI entry changed');source=source.replace(original,"if (message.command === 't065-trace') value = {...structuredClone(t065Trace),pages:browser.pages.list(taskId).map(page=>({id:page.id,session:page.helper.options.session}))};\n    else if(message.command === 't065-restore') value=t065Restore();\n    else if (message.command === 'cli') value = await launchCli");
await writeFile(root+'/host.t065.ts',source);
