import {it,expect,vi} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ApplicationToolService} from '../tool-service';
import {PackageRegistry} from '../package-registry';
import {validateRuntime} from '../runtime-registry';
import {runFixture,FixtureProcessReader} from './run-fixture';
const output='/private/tmp/willyou-m12-p100-list-alloc-001';
it('measures actual unchanged browser82 listing with real immutable contracts and SQLite',async()=>{
 const root='/private/tmp/willyou-m12-s2-package-020/mac-arm64/WillYou.app/Contents/Resources/capability-bundles/apps/browser/0.1.0/eb7f1cbfad4f8d9246ff261f8b64b2d8d778d6c28ae551b9f926fb8998f86140';
 const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8')),runtime=Buffer.from('module.exports = {};\n');
 const files=Object.fromEntries(manifest.files.map((f:{path:string})=>[f.path,readFileSync(join(root,f.path))]));
 manifest.runtime.hash=validateRuntime({id:'applications',protocolMajor:1,bridgeEntry:'mcp-bridge.cjs',files:{'mcp-bridge.cjs':runtime}}).hash;
 const reader=new FixtureProcessReader(),f=await runFixture(reader,{application:true,applicationBundle:{manifest,files},runtime});let run:Awaited<ReturnType<typeof f.create>>|undefined;
 try{run=await f.create();await run.prepare();await run.cli.arm();reader.identities.set(200001,'darwin-proc-v1:200:1');await run.cli.attach(200001);const service=new ApplicationToolService(f.store,f.runs,{resolve(){throw Error('Listing must not execute a host handler')}});const rows=[];
 for(let i=0;i<4;i++){let gets=0;const original=PackageRegistry.prototype.get;const spy=vi.spyOn(PackageRegistry.prototype,'get').mockImplementation(function(this:PackageRegistry,hash:string){gets++;return original.call(this,hash)});const before=process.memoryUsage(),start=performance.now();let listed;try{listed=await service.list(run.runId)}finally{spy.mockRestore()}const after=process.memoryUsage();expect(listed!.unavailable).toEqual([]);expect(listed!.tools.length).toBe(82);rows.push({index:i,packageGetCount:gets,elapsedMs:performance.now()-start,before,after,output:listed});}
 writeFileSync(output+'/measurement-'+(process.env.P100_ARM??'baseline')+'.json',JSON.stringify({boundary:'Private nativeSQLite composition using actual App020 browser82 schemas/manifest, only runtime hash substituted for existing synthetic runFixture; no App/model/UI/GC, no T111 credit',rows},null,2));
 }finally{if(run)await run.cli.exited();f.cleanup()}
},120000);
