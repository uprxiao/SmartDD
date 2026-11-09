import {readFile,writeFile} from 'node:fs/promises';
const root='/private/tmp/willyou-m12-t039-executor-001',base='/private/tmp/willyou-m12-p005-baseline-001';
let source=await readFile(base+'/scripts/browser/s1-service-host.ts','utf8');source=source.replaceAll("'../../src/", "'"+base+'/src/').replaceAll("'./popup-fixtures.mjs'", "'"+base+"/scripts/browser/popup-fixtures.mjs'").replaceAll("'./s3-fixtures.mjs'", "'"+base+"/scripts/browser/s3-fixtures.mjs'");
const trace=`
// T039 observation-only wrapper in private I fixture; each original is called unchanged.
import {BrowserHelper as T039Helper} from '${base}/src/main/core/browser/agent-browser';
import {BrowserCdpProxy as T039Proxy} from '${base}/src/main/core/browser/cdp-proxy';
const t039Trace={helperCalls:[] as {at:number;session:string;args:string[]}[],proxyEvents:[] as unknown[],restored:false};
const t039OriginalCommand=T039Helper.prototype.command,t039OriginalStart=T039Proxy.prototype.start;
const t039Instances=new Map<T039Proxy,(event:Record<string,unknown>)=>void>();
T039Helper.prototype.command=function(args,options){t039Trace.helperCalls.push({at:performance.now(),session:this.options.session,args:[...args]});return t039OriginalCommand.call(this,args,options)};
T039Proxy.prototype.start=function(){if(!t039Instances.has(this)){const original=Reflect.get(this,'trace') as (event:Record<string,unknown>)=>void;t039Instances.set(this,original);Reflect.set(this,'trace',(event:Record<string,unknown>)=>{t039Trace.proxyEvents.push({at:performance.now(),webContentsId:this.contents.id,...event});original(event)})}return t039OriginalStart.call(this)};
function t039Restore(){T039Helper.prototype.command=t039OriginalCommand;T039Proxy.prototype.start=t039OriginalStart;for(const [proxy,original]of t039Instances)Reflect.set(proxy,'trace',original);t039Trace.restored=true;return{restored:t039Trace.restored,helperPrototypeRestored:T039Helper.prototype.command===t039OriginalCommand,proxyPrototypeRestored:T039Proxy.prototype.start===t039OriginalStart,instanceCount:t039Instances.size}}
`;
source=trace+source;
const original="if (message.command === 'cli') value = await launchCli";
if(!source.includes(original))throw Error('Frozen host CLI entry changed');source=source.replace(original,"if (message.command === 't039-trace') value = structuredClone(t039Trace);\n    else if(message.command === 't039-restore') value=t039Restore();\n    else if (message.command === 'cli') value = await launchCli");
await writeFile(root+'/host.t039.ts',source);
