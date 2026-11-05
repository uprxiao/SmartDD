// FUTURE runtime only. Child preparation has never executed this file.
// Root copies fixtures.mjs into THIS independent project and writes scenario.json.
// host-only M10 dummy token arrives via a private file argument, never model context.
import http from 'node:http';
import {readFile,appendFile,writeFile} from 'node:fs/promises';
import {createHandler} from './fixtures.mjs';
import {calculate} from './cart-total.mjs';
const scenario=JSON.parse(await readFile(new URL('./scenario.json',import.meta.url),'utf8'));
const tokenFile=process.argv[2];if(!tokenFile)throw new Error('Private synthetic token file argument required');
const token=(await readFile(tokenFile,'utf8')).trim();
const port=Number(new URL(scenario.siteOrigin).port);if(!Number.isInteger(port)||port<1024)throw new Error('Expected pinned localhost port');
const server=http.createServer(createHandler({scenario,hostOnlySyntheticToken:token,calculate,onRecord:record=>appendFile(new URL('./requests.jsonl',import.meta.url),JSON.stringify(record)+'\n')}));
server.listen(port,'127.0.0.1',async()=>{await writeFile(new URL('./runtime.json',import.meta.url),JSON.stringify({marker:scenario.marker,pid:process.pid,cwd:process.cwd(),startedAt:new Date().toISOString(),port,executable:process.execPath,command:'node server.mjs <host-only-synthetic-token-file>',version:calculate(10,2)===20?'fixture-fixed':'fixture-v1'},null,2));});
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>server.close(()=>process.exit(0)));
