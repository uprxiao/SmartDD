import {once} from 'node:events';
import {fixture as network} from './fixtures/network.mjs';
export const ports={network:55011};
export async function startAll(){const all={network:network()};try{const f=all.network;f.server.listen({host:'127.0.0.1',port:ports.network,exclusive:true});await once(f.server,'listening');f.origin='http://127.0.0.1:'+ports.network;return {all,async close(){await f.close();return {allClosed:true,ports};}};}catch(e){await all.network.close().catch(()=>{});throw e;}}
