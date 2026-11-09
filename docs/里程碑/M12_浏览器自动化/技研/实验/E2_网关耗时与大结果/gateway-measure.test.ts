// E2: per-command cost of the M11 `willyou-app` gateway and its behavior above the 1 MiB reply cap.
// Reuses M11's native CLI fixture (real willyou-app binary, real kernel peer identity helper, real gateway,
// real SQLite/plan); the mail.draft.list data source is replaced by synthetic drafts for the size cases.
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {ApplicationCliGateway} from '../../../../../../src/main/core/applications/cli-gateway';
import {MacUnixPeerIdentityReader} from '../../../../../../src/main/core/applications/unix-peer-identity';
import {digest} from '../../../../../../src/main/core/applications/manifest';
import {cliFixture} from '../../../../../../src/main/core/applications/__tests__/cli-fixture';

const OUT=process.env.E2_OUT!;
let directory:string,binary:string,f:Awaited<ReturnType<typeof cliFixture>>,gateway:ApplicationCliGateway,environment:Record<string,string>;
const report:Record<string,unknown>={at:new Date().toISOString(),boundary:'E2 experiment: M11 native CLI fixture (real willyou-app, real peer identity helper, real gateway); synthetic mail drafts; no Codex, no packaged App'};

function run(args:string[]){
 const started=performance.now();
 return new Promise<{code:number|null;ms:number;bytes:number;stdout:string}>((ok,fail)=>{const child=spawn(binary,args,{env:environment,stdio:['ignore','pipe','pipe']});let stdout='';child.stdout.on('data',c=>{stdout+=c;});child.once('error',fail);child.once('close',code=>ok({code,ms:Math.round(performance.now()-started),bytes:Buffer.byteLength(stdout),stdout}));});
}
const stats=(values:number[])=>{const s=[...values].sort((a,b)=>a-b);return{n:s.length,min:s[0],median:s[Math.floor(s.length/2)],p90:s[Math.floor(s.length*0.9)],max:s.at(-1)};};
const drafts=(count:number,subjectChars:number)=>Array.from({length:count},(_,i)=>({id:randomUUID(),revision:1,state:'draft',subject:'复'.repeat(subjectChars),attachmentCount:0,createdAt:'2026-11-03T00:00:00.000Z',updatedAt:'2026-11-03T00:00:00.000Z',i})).map(({i:_,...d})=>d);

beforeAll(async()=>{
 directory=realpathSync(mkdtempSync('/private/tmp/willyou-m12-e2-'));binary=join(directory,'willyou-app');
 execFileSync(process.execPath,['--input-type=module','-e','import {buildApplicationCli} from "./scripts/applications/build.mjs";buildApplicationCli({output:process.argv[1]});',binary],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:'pipe',timeout:30000});
 f=await cliFixture({nativeRoot:true});
 gateway=new ApplicationCliGateway(f.runs,f.cli,new MacUnixPeerIdentityReader(resolve('out/native/willyou-process-identity')),{executable:{path:binary,sha256:digest(readFileSync(binary))}});
 await gateway.start();environment={...gateway.issue(f.run).environment};
});
afterAll(async()=>{await gateway?.close();vi.restoreAllMocks();await f?.cleanup();rmSync(directory,{recursive:true,force:true});writeFileSync(join(OUT,'result.json'),JSON.stringify(report,null,2));});

describe('E2 M11 gateway cost and size cap',()=>{
 it('measures warm per-command latency for --list and a read call',async()=>{
  await run(['--list']);
  const list:number[]=[],call:number[]=[];
  for(let i=0;i<20;i++){const r=await run(['--list']);expect(r.code).toBe(0);list.push(r.ms);}
  for(let i=0;i<20;i++){const r=await run(['mail','draft','list','--limit','1']);expect(r.code).toBe(0);call.push(r.ms);}
  report.latencyMs={list:stats(list),call:stats(call)};
 },120000);
 it('returns results below the cap and reports what happens above 1 MiB',async()=>{
  const cases:[string,number,number][]=[['~0.3MB',100,1000],['~0.9MB',150,2000],['~1.2MB',200,2000]];
  const sizes:Record<string,unknown>[]=[];
  for(const[label,count,chars]of cases){
   const payload={items:drafts(count,chars),nextCursor:null};
   vi.spyOn(f.applications.data,'execute').mockResolvedValueOnce(payload as never);
   const r=await run(['mail','draft','list','--limit','200']);
   let parsed:unknown=null;try{parsed=JSON.parse(r.stdout);}catch{}
   sizes.push({label,payloadBytes:Buffer.byteLength(JSON.stringify(payload)),exit:r.code,ms:r.ms,stdoutBytes:r.bytes,error:(parsed as {error?:unknown})?.error??null,itemsReturned:(parsed as {data?:{items?:unknown[]}})?.data?.items?.length??null});
  }
  report.sizes=sizes;
 },120000);
});
