// Constructed historical run, not a real Agent acceptance claim. The original
// registry registers an actual short-lived sleep process; no exit receipt is
// sent, then this preparation host exits. Startup uses the real kernel helper.
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {readFileSync,readdirSync,lstatSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runFixture} from '../../../src/main/core/applications/__tests__/run-fixture';
import {MacProcessIdentityReader} from '../../../src/main/core/applications/process-identity';
const [output,helper]=process.argv.slice(2);
if(!output?.startsWith('/private/tmp/willyou-m10-startup-')||!helper?.startsWith('/private/tmp/willyou-m10-'))throw Error('Only the explicit isolated startup fixture');
const reader=new MacProcessIdentityReader(helper);
async function main(){
 const f=await runFixture(reader,{application:true}),run=await f.create();await run.prepare();await run.cli.arm();
 const child=spawn('/bin/sleep',['30'],{stdio:'ignore'});await once(child,'spawn');if(!child.pid)throw Error('Missing own child PID');await run.cli.attach(child.pid);const childIdentity=reader.read(child.pid);if(!childIdentity)throw Error('Missing original kernel child identity');
 child.kill('SIGTERM');await once(child,'close');if(reader.state(childIdentity)!=='stopped')throw Error('Own child not proved stopped');
 const facts={snapshots:f.sqlite.prepare('SELECT * FROM capability_session_snapshots ORDER BY task_id').all(),refs:f.sqlite.prepare('SELECT * FROM capability_session_refs ORDER BY ref_kind,ref_id').all()};
 const files:Record<string,{sha256:string;ino:number;dev:number;bytes:number}>={};function scan(dir:string){for(const name of readdirSync(dir)){const path=join(dir,name),s=lstatSync(path);if(s.isSymbolicLink())throw Error('Unexpected seed link');if(s.isDirectory())scan(path);else files[path]={sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),ino:s.ino,dev:s.dev,bytes:s.size};}}scan(f.store.root);
 const proof={schema:1,layer:'I constructed history with actual kernel identities and real registry/files/SQLite;generator plus sleep,not actual CC/Codex',root:f.root,home:f.home,owner:reader.read(process.pid),child:childIdentity,runId:run.runId,runs:f.sqlite.prepare('SELECT * FROM capability_runs').all(),processes:f.sqlite.prepare('SELECT * FROM capability_run_processes').all(),leases:f.sqlite.prepare("SELECT * FROM capability_resource_leases WHERE state<>'released'").all(),active:f.sqlite.prepare('SELECT * FROM capability_active_packages ORDER BY app_id').all(),facts,files};
 f.sqlite.close();renameSync(join(f.root,'state.sqlite'),join(f.root,'smartdd.db'));writeFileSync(output,JSON.stringify(proof,null,2));
}
void main().catch(error=>{process.stderr.write(String(error));process.exitCode=1;});
