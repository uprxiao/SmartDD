import {it,expect,vi} from 'vitest';
import {writeFileSync} from 'node:fs';
import {PackageRegistry} from '../package-registry';
import {browserListFixture} from './p100-browser-fixture';
const output='/private/tmp/willyou-m12-p100-list-alloc-001';
it('measures actual browser82 CLI listing with real V3 plan, immutable contracts and SQLite',async()=>{
 const f=await browserListFixture();try{const rows=[];
 for(let i=0;i<4;i++){let gets=0;const original=PackageRegistry.prototype.get;const spy=vi.spyOn(PackageRegistry.prototype,'get').mockImplementation(function(this:PackageRegistry,hash:string){gets++;return original.call(this,hash)});const before=process.memoryUsage(),start=performance.now();let listed;try{listed=await f.cli.list(f.run.runId)}finally{spy.mockRestore()}const after=process.memoryUsage();expect(listed!.unavailable).toEqual([]);expect(listed!.tools.length).toBe(82);rows.push({index:i,packageGetCount:gets,elapsedMs:performance.now()-start,before,after,output:listed});}
 writeFileSync(output+'/measurement-'+(process.env.P100_ARM??'baseline')+'.json',JSON.stringify({boundary:'Private nativeSQLite composition using frozen source024 actual browser82 bundle, V3 plan and exact immutable contract bytes; original fixture Agent/kernel stubs, no App/model/UI/GC, no T111 credit',rows},null,2));
 }finally{await f.cleanup()}
},120000);
