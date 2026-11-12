import {Socket,connect} from 'node:net';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {RunBackendAuthority,type RunBackendReservation} from '../run-backend-authority';
import {ApplicationCliGateway} from '../cli-gateway';
import type {UnixPeerIdentity} from '../unix-peer-identity';
import {cliFixture} from './cli-fixture';
import {runFixture} from './run-fixture';

let f:Awaited<ReturnType<typeof cliFixture>>,authority:RunBackendAuthority,ticket:RunBackendReservation;
let control:Socket,proof:UnixPeerIdentity|null,signals:number[];
const birth=(pid:number)=>'darwin-proc-v1:2026:'+pid;
const launcherPid=922001,serverPid=922002,leafPid=922003;
const ancestor=(pid:number,ppid:number)=>({pid,ppid,startedAt:birth(pid)});
const peer=(pid:number,path:string,ancestors:UnixPeerIdentity['ancestors']):UnixPeerIdentity=>({schema:2,state:'running',uid:process.getuid!(),peer:{pid,startedAt:birth(pid),executable:path},ancestors});
const leaf=()=>peer(leafPid,f.executable,[ancestor(leafPid,serverPid),ancestor(serverPid,launcherPid),ancestor(launcherPid,process.pid)]);
const rows=()=>f.sqlite.prepare("SELECT state,pid FROM capability_run_processes WHERE run_id=? AND kind='bridge' ORDER BY rowid").all(f.run.runId);
async function reserve(){ticket=await authority.reserve(f.run,{path:f.executable,sha256:f.executableHash});return ticket;}
async function arm(){await reserve();await ticket.launcher.arm();await ticket.server.arm();await ticket.launcher.attach(launcherPid,birth(launcherPid));}
async function bind(){await arm();await ticket.bindControl(control);}
beforeEach(async()=>{
  f=await cliFixture();signals=[];control=new Socket();
  f.reader.identities.set(launcherPid,birth(launcherPid));f.reader.identities.set(serverPid,birth(serverPid));f.reader.identities.set(leafPid,birth(leafPid));
  proof=peer(serverPid,f.executable,[ancestor(serverPid,launcherPid),ancestor(launcherPid,process.pid)]);
  authority=new RunBackendAuthority(f.runs,{read:async()=>proof},f.reader,{pollMs:10000,disposeWaitMs:1,signal:identity=>signals.push(identity.pid)});
});
afterEach(async()=>{
  vi.restoreAllMocks();control.destroy();
  f.reader.unknown.clear();f.reader.identities.delete(serverPid);f.reader.identities.delete(launcherPid);
  await authority.poll();await authority.dispose();await f.cleanup();
});

describe('host-attested per-run backend authority (software fixtures, not a native Codex turn)',()=>{
  it('persists both fork windows, admits only the verified server descendants, and keeps CLI identity unchanged',async()=>{
    await reserve();expect(rows()).toEqual([{state:'reserved',pid:null},{state:'reserved',pid:null}]);
    expect(authority.authorize(f.run.runId,leaf())).toBe(false);
    await ticket.launcher.arm();await ticket.server.arm();await ticket.launcher.attach(launcherPid,birth(launcherPid));
    await ticket.bindControl(control);expect(rows()).toEqual([{state:'active',pid:launcherPid},{state:'active',pid:serverPid}]);
    expect(authority.authorize(f.run.runId,leaf())).toBe(true);
    expect(authority.authorize(randomUUID(),leaf())).toBe(false);
    expect(authority.authorize(f.run.runId,proof!)).toBe(false);
    expect(f.runs.get(f.run.runId)).toMatchObject({pid:921001,state:'active'});
  });
  it('rejects a structural copy of a run handle before reserving or reading another process',async()=>{
    await expect(authority.reserve({...f.run},{path:f.executable,sha256:f.executableHash})).rejects.toMatchObject({code:'SCOPE_DENIED'});
    expect(rows()).toEqual([]);expect(signals).toEqual([]);
  });
  it('does not mint backend roots for a Claude run',async()=>{
    const other=await runFixture();const reader=other.reader;
    const own=new RunBackendAuthority(other.runs,{read:async()=>proof},reader,{disposeWaitMs:1});
    try{const run=await other.create();await run.prepare();await expect(own.reserve(run,{path:f.executable,sha256:f.executableHash})).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(other.sqlite.prepare("SELECT count(*) n FROM capability_run_processes WHERE kind='bridge'").get()).toEqual({n:0});await run.cancelBeforeFork();}finally{await own.dispose();other.cleanup();}
  });
  it.each(['unarmed','missing-peer','uid','image','root-birth','outsider','reused-root'] as const)('rejects %s server proof without opening host authority',async mode=>{
    await arm();
    if(mode==='unarmed')f.sqlite.prepare("UPDATE capability_run_processes SET state='reserved' WHERE process_id=?").run(ticket.server.processId);
    if(mode==='missing-peer')proof=null;
    if(mode==='uid')proof!.uid++;
    if(mode==='image')proof!.peer.executable='/usr/bin/false';
    if(mode==='root-birth')proof!.ancestors[1].startedAt=birth(999999);
    if(mode==='outsider')proof!.ancestors=[ancestor(serverPid,1)];
    if(mode==='reused-root')f.reader.identities.set(launcherPid,birth(999998));
    await expect(ticket.bindControl(control)).rejects.toMatchObject({code:'SCOPE_DENIED'});
    expect(authority.authorize(f.run.runId,leaf())).toBe(false);
    expect(rows()[1]).not.toMatchObject({state:'active'});
  });
  it.each(['cli-unknown','cli-stopped','server-unknown','server-reused','root-unknown','image-changed','wrong-peer-uid','wrong-ancestor-birth','foreign-server','row-changed'] as const)('revokes admission on %s while preserving the original ancestry path',async mode=>{
    await bind();let candidate=leaf();
    expect(authority.authorize(f.run.runId,candidate)).toBe(true);
    if(mode==='cli-unknown')f.reader.unknown.add(921001);
    if(mode==='cli-stopped')f.reader.identities.delete(921001);
    if(mode==='server-unknown')f.reader.unknown.add(serverPid);
    if(mode==='server-reused')f.reader.identities.set(serverPid,birth(123456));
    if(mode==='root-unknown')f.reader.unknown.add(launcherPid);
    if(mode==='image-changed')writeFileSync(f.executable,'changed fixture executable');
    if(mode==='wrong-peer-uid')candidate.uid++;
    if(mode==='wrong-ancestor-birth')candidate.ancestors[1].startedAt=birth(123456);
    if(mode==='foreign-server')candidate=peer(leafPid,f.executable,[ancestor(leafPid,932002),ancestor(932002,process.pid)]);
    if(mode==='row-changed')f.sqlite.prepare("UPDATE capability_run_processes SET process_started_at=? WHERE process_id=?").run(birth(123456),ticket.server.processId);
    expect(authority.authorize(f.run.runId,candidate)).toBe(false);
  });
  it('revokes on control disconnect but retains both live/unknown process leases until original identities are stopped',async()=>{
    await bind();control.destroy();await vi.waitFor(()=>expect(authority.authorize(f.run.runId,leaf())).toBe(false));
    await vi.waitFor(()=>expect(f.runs.get(f.run.runId).state).toBe('stopping'));
    await authority.poll();expect(rows()).toEqual([{state:'active',pid:launcherPid},{state:'active',pid:serverPid}]);
    f.reader.unknown.add(serverPid);f.reader.identities.delete(launcherPid);await authority.poll();
    expect(rows()).toEqual([{state:'exited',pid:launcherPid},{state:'active',pid:serverPid}]);expect(f.runs.get(f.run.runId).state).toBe('stopping');
    f.reader.unknown.clear();f.reader.identities.delete(serverPid);await authority.poll();await f.run.cli.exited();expect(f.runs.get(f.run.runId).state).toBe('stopped');
  });
  it('does not signal reused or unknown PIDs during revocation',async()=>{
    await bind();f.reader.unknown.add(serverPid);f.reader.identities.set(launcherPid,birth(123456));authority.revokeRun(f.run.runId);expect(signals).toEqual([]);expect(rows()[1]).toMatchObject({state:'active'});
  });
  it('requires the native TUI to be active before any descendant can use a server root',async()=>{
    await bind();f.sqlite.prepare("UPDATE capability_runs SET state='prepared',pid=NULL,process_started_at=NULL WHERE run_id=?").run(f.run.runId);expect(authority.authorize(f.run.runId,leaf())).toBe(false);
  });
  it('denies a control bind completing after stop and joins its pending identity read at disposal',async()=>{
    let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(done=>entered=done),gate=new Promise<void>(done=>release=done);
    await authority.dispose();authority=new RunBackendAuthority(f.runs,{read:async()=>{entered();await gate;return proof;}},f.reader,{disposeWaitMs:1,signal:id=>signals.push(id.pid)});
    await arm();const work=ticket.bindControl(control);void work.catch(()=>{});await ready;
    const closing=authority.dispose();let closed=false;void closing.then(()=>closed=true);await Promise.resolve();expect(closed).toBe(false);
    release();await closing;await expect(work).rejects.toMatchObject({code:'SCOPE_DENIED'});expect(authority.authorize(f.run.runId,leaf())).toBe(false);
  });
  it('uses the same authority in the real CLI gateway without bypassing token, binary or capability checks',async()=>{
    await bind();let candidate=leaf();const gateway=new ApplicationCliGateway(f.runs,f.cli,{read:async()=>candidate},{executable:{path:f.executable,sha256:f.executableHash},additionalRoot:authority});
    await gateway.start();const issued=gateway.issue(f.run),socket=connect(gateway.endpoint);socket.on('error',()=>{});await once(socket,'connect');
    const send=async(extra:Record<string,unknown>={})=>{
      const response=once(socket,'data');socket.write(JSON.stringify({schema:'willyou-cli-v1',id:randomUUID(),token:issued.environment.WILLYOU_RUN_TOKEN,method:'capabilities/call',call:{operation:'mail.draft.list',contractMajor:2,connectionId:null,arguments:{}},...extra})+'\n');return JSON.parse((await response)[0].toString());
    };
    try{
      expect(await send()).toMatchObject({status:'ok',value:{data:{items:[]}}});
      expect(await send({token:'f'.repeat(64)})).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
      candidate={...leaf(),peer:{...leaf().peer,executable:'/usr/bin/false'}};expect(await send()).toMatchObject({status:'error',error:{code:'EXECUTABLE_MISMATCH'}});
      candidate=leaf();expect(await send({call:{operation:'mail.draft.create',contractMajor:2,connectionId:null,arguments:{}}})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
      authority.revokeRun(f.run.runId);expect(await send()).toMatchObject({status:'error',error:{code:'PEER_MISMATCH'}});
      expect(f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:1});
    }finally{socket.destroy();await gateway.close();}
  });
});
