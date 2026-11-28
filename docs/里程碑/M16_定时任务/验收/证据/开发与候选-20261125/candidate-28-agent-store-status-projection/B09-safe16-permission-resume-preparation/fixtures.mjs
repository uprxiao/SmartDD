import {once} from 'node:events';
import {fixture as network} from './fixtures/network.mjs';
import {fixture as download,payload,downloadName,totalBytes} from './fixtures/download.mjs';
import {fixture as profile} from './fixtures/profile.mjs';
import {fixture as auth,credentials} from './fixtures/auth.mjs';
import {fixture as external} from './fixtures/external.mjs';
import {fixture as permission} from './fixtures/permission.mjs';
export {payload,downloadName,totalBytes,credentials};
export const ports={network:55011,download:64685,profile:61917,auth:57320,external:57321,permission:57322};
export async function startAll(){const all={network:network(),download:download(),profile:profile(),auth:auth(),external:external(),permission:permission()};try{for(const [key,f]of Object.entries(all)){f.server.listen({host:'127.0.0.1',port:ports[key],exclusive:true});await once(f.server,'listening');f.origin='http://127.0.0.1:'+ports[key];}return {all,async close(){const results=await Promise.allSettled(Object.values(all).map(f=>f.close()));if(results.some(r=>r.status!=='fulfilled'))throw Error('Private fixture cleanup incomplete');return {allClosed:true,ports};}};}catch(e){await Promise.allSettled(Object.values(all).map(f=>f.close()));throw e;}}
