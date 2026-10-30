import {writeSync} from 'node:fs';
import {join} from 'node:path';
import Database from 'better-sqlite3';
import {ResourceStore} from '../../resource-store';
import {CapabilitySessionRegistry} from '../../session-registry';
import {CapabilityRunRegistry} from '../../run-registry';
import {DiscoveryCatalog} from '../../discovery-catalog';
import {MacProcessIdentityReader} from '../../process-identity';

const [root,home,helper,phase,taskId]=process.argv.slice(2);
const sqlite=new Database(join(root,'state.sqlite'));
sqlite.pragma('foreign_keys=ON');
const processes=new MacProcessIdentityReader(helper),store=new ResourceStore(sqlite,root,undefined,{processes});
// The parent prepared and verified S/resources. This child only reserves its
// existing S; a newly introduced verification path must not silently pass.
const unexpected=()=>{throw new Error('reservation checkpoint must not bypass verification');};
const sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:unexpected,verifyExtraResource:unexpected});
const runs=new CapabilityRunRegistry(store,sessions,{processes,assertCurrent:()=>{},revoke:()=>{}});
const catalog=new DiscoveryCatalog(store,home,processes,{instanceId:runs.instanceId});
function checkpoint(at:string,ids:{runId:string;ptyId:string}){
  if(at!==phase)return;
  writeSync(1,JSON.stringify({phase:at,pid:process.pid,...ids})+'\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
}
void (async()=>{
  const collection=await catalog.snapshot(),saved=await sessions.get(taskId);
  await catalog.reserveRun(collection.generation,'codex',async ids=>{
    checkpoint('h-intent',ids);
    const run=await runs.reserve({taskId,snapshotHash:saved.pointer.snapshotHash,bindings:[]},ids);
    checkpoint('c-committed',ids);
    return run;
  });
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>sqlite.close());
