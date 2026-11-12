import {spawn,type ChildProcess} from 'node:child_process';
import {once} from 'node:events';
import {connect,createServer,type Socket} from 'node:net';
import {mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {RunBackendAuthority} from '../run-backend-authority';
import {AgentBridgeProcesses} from '../agent-bridge-processes';
import {MacProcessIdentityReader} from '../process-identity';
import {MacUnixPeerIdentityReader} from '../unix-peer-identity';
import {digest} from '../manifest';
import {cliFixture} from './cli-fixture';

async function bounded<T>(work:Promise<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('private native backend fixture timeout')),5000);})]);}finally{if(timer)clearTimeout(timer);}}
async function stop(child:ChildProcess|undefined){if(!child||child.exitCode!==null||child.signalCode!==null)return;const exited=once(child,'exit');child.kill('SIGTERM');await bounded(exited);}

describe.skipIf(process.platform!=='darwin')('native kernel backend ownership with a sibling terminal (synthetic Agent)',()=>{
  it('rejects the ordinary CLI ancestry path, admits the attested backend path, and reaps exact owned children',async()=>{
    const root=realpathSync(mkdtempSync('/tmp/wy-m13-backend-native-')),helper=resolve('out/native/willyou-process-identity'),processes=new MacProcessIdentityReader(helper),peers=new MacUnixPeerIdentityReader(helper);
    let cli:ChildProcess|undefined,backend:ChildProcess|undefined,control:Socket|undefined,leafSocket:Socket|undefined,f:Awaited<ReturnType<typeof cliFixture>>|undefined,authority:RunBackendAuthority|undefined,ordinary:AgentBridgeProcesses|undefined,delegated:AgentBridgeProcesses|undefined;
    const listener=createServer();listener.on('error',()=>{});const leafPath=join(root,'leaf.sock'),serverPath=join(root,'server.sock');
    try{
      cli=spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{env:{ELECTRON_RUN_AS_NODE:'1'},stdio:'ignore'});await bounded(once(cli,'spawn'));
      f=await cliFixture({nativeCliPid:cli.pid!});authority=new RunBackendAuthority(f.runs,peers,processes,{pollMs:10000,disposeWaitMs:100});
      const ticket=await authority.reserve(f.run,{path:realpathSync(process.execPath),sha256:digest(readFileSync(process.execPath))});
      await ticket.launcher.arm();await ticket.server.arm();
      backend=spawn(process.execPath,[resolve('src/main/core/applications/__tests__/fixtures/private-backend.cjs'),serverPath],{env:{ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']});
      await bounded(once(backend,'spawn'));const backendIdentity=processes.read(backend.pid!)!;expect(backendIdentity).toBeTruthy();
      f.reader.identities.set(backendIdentity.pid,backendIdentity.startedAt);await ticket.launcher.attach(backendIdentity.pid,backendIdentity.startedAt);
      if(!backend.stdout!.readableLength)await bounded(once(backend.stdout!,'data'));
      control=connect(serverPath);control.on('error',()=>{});await bounded(once(control,'connect'));
      const nativeServer=(await peers.read(control))!;expect(nativeServer.peer.pid).toBe(backend.pid);expect(nativeServer.ancestors.some(p=>p.pid===cli!.pid)).toBe(false);
      await ticket.bindControl(control);
      await new Promise<void>(done=>listener.listen(leafPath,done));const accepted=once(listener,'connection') as Promise<[Socket]>;
      const bridge=await f.run.reserveBridge();await bridge.arm();control.write(JSON.stringify({method:'spawn-leaf',path:leafPath})+'\n');
      [leafSocket]=await bounded(accepted);leafSocket.on('error',()=>{});leafSocket.resume();
      const nativeLeaf=(await peers.read(leafSocket))!;expect(nativeLeaf.ancestors.some(p=>p.pid===cli!.pid)).toBe(false);expect(nativeLeaf.ancestors.some(p=>p.pid===backend!.pid&&p.startedAt===backendIdentity.startedAt)).toBe(true);
      f.reader.identities.set(nativeLeaf.peer.pid,nativeLeaf.peer.startedAt);
      ordinary=new AgentBridgeProcesses(f.runs,peers,processes,{pollMs:10000,disposeWaitMs:100});
      await expect(ordinary.attach(leafSocket,f.run.runId,bridge)).rejects.toMatchObject({code:'SCOPE_DENIED'});
      delegated=new AgentBridgeProcesses(f.runs,peers,processes,{pollMs:10000,disposeWaitMs:100,additionalRoot:authority});
      await delegated.attach(leafSocket,f.run.runId,bridge);expect(authority.authorize(f.run.runId,nativeLeaf)).toBe(true);
      const recorded=f.sqlite.prepare('SELECT state,pid,process_started_at FROM capability_run_processes WHERE process_id=?').get(bridge.processId);
      expect(recorded).toEqual({state:'active',pid:nativeLeaf.peer.pid,process_started_at:nativeLeaf.peer.startedAt});
      authority.revokeRun(f.run.runId);expect(authority.authorize(f.run.runId,nativeLeaf)).toBe(false);
      if(backend.exitCode===null&&backend.signalCode===null)await bounded(once(backend,'exit'));
      expect(processes.state(backendIdentity)).toBe('stopped');expect(processes.state(nativeLeaf.peer)).toBe('stopped');
      f.reader.identities.delete(backendIdentity.pid);f.reader.identities.delete(nativeLeaf.peer.pid);
      await authority.poll();await delegated.poll();await stop(cli);await f.run.cli.exited();expect(f.runs.get(f.run.runId).state).toBe('stopped');
      const evidence=process.env.WILLYOU_P1_BACKEND_EVIDENCE;
      if(evidence){if(!evidence.startsWith('/private/tmp/willyou-m13-'))throw Error('Evidence path must be private test tmp');writeFileSync(evidence,JSON.stringify({schema:1,layer:'native-synthetic-agent',nativeServer,nativeLeaf,cliPid:cli.pid,recorded,runState:f.runs.get(f.run.runId).state,backendExit:{code:backend.exitCode,signal:backend.signalCode},cliExit:{code:cli.exitCode,signal:cli.signalCode},actualCodex:false},null,2)+'\n');}
    }finally{
      control?.destroy();leafSocket?.destroy();await stop(backend);await stop(cli);
      await delegated?.poll();await authority?.poll();await delegated?.dispose();await ordinary?.dispose();await authority?.dispose();
      await new Promise<void>(done=>listener.close(()=>done()));await f?.cleanup();rmSync(root,{recursive:true,force:true});
    }
  },20000);
});
