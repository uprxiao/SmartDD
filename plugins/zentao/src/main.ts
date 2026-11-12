import {createInterface} from 'node:readline';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {ApplicationError} from '@shared/applications';
import {packagedZentaoRuntime} from './runtime';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),manifest=JSON.parse(readFileSync(resolve(root,'.willyou-plugin/plugin.json'),'utf8'));
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});let runtime:ReturnType<typeof packagedZentaoRuntime>|undefined;
const send=(value:unknown)=>{const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>256*1024)throw new ApplicationError('TOO_LARGE','Response exceeds protocol frame budget');process.stdout.write(bytes+'\n');};
lines.on('line',async line=>{
  let id:unknown;
  try{
    if(Buffer.byteLength(line)>256*1024)throw new Error('Input exceeds protocol budget');const message=JSON.parse(line);id=message.id;
    if(message.jsonrpc!=='2.0'||!Number.isSafeInteger(id))throw new Error('Invalid RPC frame');let result:unknown;
    if(message.method==='initialize'){if(runtime)throw new Error('Already initialized');runtime=packagedZentaoRuntime(process.env.WILLYOU_PLUGIN_DATA!,root);result={protocol:'jsonrpc-stdio/1',plugin:manifest.id,version:manifest.version};}
    else{if(!runtime)throw new Error('Runtime not initialized');const signal=AbortSignal.timeout(28000);if(message.method==='verify')result=await runtime.verify(message.params,signal);else if(message.method==='execute')result=await runtime.execute(message.params.capability,message.params.input,message.params.connection,message.params.scope,signal);else throw new Error('Unknown method');}
    send({jsonrpc:'2.0',id,result});
  }catch(error){if(!Number.isSafeInteger(id)){process.exitCode=2;lines.close();return;}send({jsonrpc:'2.0',id,error:{code:-32000,message:'Plugin operation failed',...(error instanceof ApplicationError?{data:{code:error.code}}:{})}});}
});
lines.on('close',()=>{try{runtime?.close();}catch{/* Process exit does not replay reads or writes. */}});
