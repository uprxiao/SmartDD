import {readFile,writeFile} from 'node:fs/promises';
const root='/private/tmp/willyou-m12-t065-executor-001',base='/private/tmp/willyou-m12-p007-baseline-001';
let source=await readFile(base+'/scripts/browser/s1-service-host.ts','utf8');source=source.replaceAll("'../../src/", "'"+base+'/src/').replaceAll("'./popup-fixtures.mjs'", "'"+base+"/scripts/browser/popup-fixtures.mjs'").replaceAll("'./s3-fixtures.mjs'", "'"+base+"/scripts/browser/s3-fixtures.mjs'");
const trace=`
// T065 observation-only wrapper in private I fixture; each original is called unchanged.
import {BrowserHelper as T065Helper} from '${base}/src/main/core/browser/agent-browser';
import {BrowserCdpProxy as T065Proxy} from '${base}/src/main/core/browser/cdp-proxy';
const t065Trace={helperCalls:[] as {at:number;session:string;args:string[]}[],proxyEvents:[] as unknown[],restored:false};
const t065OriginalCommand=T065Helper.prototype.command,t065OriginalStart=T065Proxy.prototype.start;
const t065Instances=new Map<T065Proxy,(event:Record<string,unknown>)=>void>();
T065Helper.prototype.command=function(args,options){t065Trace.helperCalls.push({at:performance.now(),session:this.options.session,args:[...args]});return t065OriginalCommand.call(this,args,options)};
T065Proxy.prototype.start=function(){if(!t065Instances.has(this)){const original=Reflect.get(this,'trace') as (event:Record<string,unknown>)=>void;t065Instances.set(this,original);Reflect.set(this,'trace',(event:Record<string,unknown>)=>{t065Trace.proxyEvents.push({at:performance.now(),webContentsId:this.contents.id,...event});original(event)})}return t065OriginalStart.call(this)};
function t065Restore(){T065Helper.prototype.command=t065OriginalCommand;T065Proxy.prototype.start=t065OriginalStart;for(const [proxy,original]of t065Instances)Reflect.set(proxy,'trace',original);t065Trace.restored=true;return{restored:t065Trace.restored,helperPrototypeRestored:T065Helper.prototype.command===t065OriginalCommand,proxyPrototypeRestored:T065Proxy.prototype.start===t065OriginalStart,instanceCount:t065Instances.size}}
`;
source=trace+source;
const original="if (message.command === 'cli') value = await launchCli";
if(!source.includes(original))throw Error('Frozen host CLI entry changed');source=source.replace(original,"if (message.command === 't065-trace') value = structuredClone(t065Trace);\n    else if(message.command === 't065-restore') value=t065Restore();\n    else if (message.command === 'cli') value = await launchCli");
await writeFile(root+'/host.t065.ts',source);
