// T68 protocol/service supplement. Real sockets and SQLite; simulated process
// identity and fixed read-only adapter, not the complete two-App/CLI acceptance.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { applicationMcpServerName, applicationNativeSkillName } from '../../../src/shared/application-session';
import { digest } from '../../../src/main/core/applications/manifest';
import { applicationSkillContentHash } from '../../../src/main/core/applications/session-registry';
import { ApplicationToolService } from '../../../src/main/core/applications/tool-service';
import { PrivateApplicationBroker } from '../../../src/main/core/applications/private-broker';
import { FixtureProcessReader, runFixture } from '../../../src/main/core/applications/__tests__/run-fixture';
import type { BridgeResponse, BridgeBootstrap } from '../../../src/shared/application-bridge';

it('T68 routes simultaneous project/version runs by host scope and rejects cross-socket credentials and forged overrides',async()=>{
 const reader=new FixtureProcessReader(),f=await runFixture(reader,{application:true});
 const sockets:Socket[]=[];let broker:PrivateApplicationBroker|undefined,calls=0;
 async function peer(endpoint:string){
  const socket=connect(endpoint);sockets.push(socket);socket.on('error',()=>{});await once(socket,'connect');let buffer='';
  const waiting=new Map<string,{resolve:(v:BridgeResponse)=>void,reject:(e:Error)=>void,timer:ReturnType<typeof setTimeout>}>();
  socket.on('close',()=>{for(const p of waiting.values()){clearTimeout(p.timer);p.reject(new Error('closed'));}waiting.clear();});
  socket.on('data',chunk=>{buffer+=chunk.toString();while(buffer.includes('\n')){const i=buffer.indexOf('\n'),v=JSON.parse(buffer.slice(0,i)) as BridgeResponse;buffer=buffer.slice(i+1);const p=waiting.get(v.id);if(p){clearTimeout(p.timer);waiting.delete(v.id);p.resolve(v);}}});
  return {socket,send:(request:Record<string,unknown>)=>new Promise<BridgeResponse>((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>{waiting.delete(id);reject(new Error('bounded protocol timeout'));},3000);waiting.set(id,{resolve,reject,timer});socket.write(JSON.stringify({schema:1,...request,id})+'\n');})};
 }
 try{
  f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','isolated second project',1,1)");
  const source={manifest:structuredClone(f.applicationSource!.manifest),files:{...f.applicationSource!.files}};source.manifest.version='2.0.0';
  const newer=await f.packageRegistry.install(source),second=structuredClone(f.snapshot);second.taskId=randomUUID();second.projectId='p2';
  const name=applicationMcpServerName(digest(second.taskId));second.mcp[0].serverName=name;
  second.adapterBinding.nativeToolNames=Object.fromEntries(source.manifest.tools.map(t=>[t.name,'mcp__'+name+'__'+t.name]));
  Object.assign(second.packages[0],{version:newer.version,packageHash:newer.packageHash,skills:source.manifest.skills.map(s=>{const native=applicationNativeSkillName('zentao',s.id,newer.packageHash);return{skillId:s.id,nativeName:native,contentHash:applicationSkillContentHash(source.manifest,s.path),sourceRelativePath:s.path,projectionPath:join(f.store.root,'sessions',second.taskId,'claude/plugin/skills',native,'SKILL.md')};})});
  const saved=await f.sessions.create(second,f.home),one=await f.create(),two=await f.runs.reserve({taskId:second.taskId,snapshotHash:saved.pointer.snapshotHash,bindings:[]});
  for(const [run,pid] of [[one,200001],[two,200002]] as const){await run.prepare();await run.cli.arm();reader.identities.set(pid,'darwin-proc-v1:200:'+pid);await run.cli.attach(pid);}
  const tools=new ApplicationToolService(f.store,f.runs,{resolve:()=>({semantics:'read',retry:'never',authorize:()=>{},execute:async(ctx,args,op)=>{calls++;return{value:String(args.value),packageHash:op.packageHash,projectId:ctx.run.projectId,taskId:ctx.run.taskId,operationId:op.operationId};}})});
  broker=new PrivateApplicationBroker(f.runs,tools);await broker.start();
  async function authenticate(run:typeof one,serverName:string){const issued=await broker!.prepare(run,serverName);await issued.bridge.arm();const data=JSON.parse(readFileSync(issued.bootstrapPath,'utf8')) as BridgeBootstrap,client=await peer(broker!.endpoint);const response=await client.send({method:'exchange',runId:data.runId,bridgeId:data.bridgeId,secret:data.secret});expect(response.status).toBe('ok');if(response.status!=='ok')throw new Error('authentication failed');return{client,bridge:issued.bridge,token:(response.value as {token:string}).token};}
  const a=await authenticate(one,f.snapshot.mcp[0].serverName),b=await authenticate(two,name);
  const call={operation:'smartdd_zentao_query_v1',contractMajor:1,connectionId:null,arguments:{value:'isolated'}};
  const [first,last]=await Promise.all([a.client.send({method:'tools/call',token:a.token,call}),b.client.send({method:'tools/call',token:b.token,call})]);
  expect(first).toMatchObject({status:'ok',value:{projectId:'p1',taskId:f.snapshot.taskId,packageHash:f.application!.packageHash}});
  expect(last).toMatchObject({status:'ok',value:{projectId:'p2',taskId:second.taskId,packageHash:newer.packageHash}});expect(calls).toBe(2);
  for(const extra of [{projectId:'p2'},{taskId:second.taskId},{runId:two.runId},{packageHash:newer.packageHash},{approved:true},{permissions:['zentao.read']},{callerKind:'ui'}])expect(await a.client.send({method:'tools/call',token:a.token,call,...extra})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
  for(const altered of [{...call,contractMajor:2},{...call,operation:'not_declared_v1'}]){const response=await a.client.send({method:'tools/call',token:a.token,call:altered});expect(response.status).toBe('error');}
  expect(calls).toBe(2);
  const outside=await peer(broker.endpoint);expect(await outside.send({method:'tools/call',call})).toMatchObject({status:'error'});expect(calls).toBe(2);
  expect(await a.client.send({method:'tools/call',token:a.token,call})).toMatchObject({status:'ok',value:{projectId:'p1',packageHash:f.application!.packageHash}});expect(calls).toBe(3);
  const audit=JSON.stringify(f.sqlite.prepare('SELECT * FROM application_invocations').all());expect(audit).not.toContain(a.token);expect(audit).not.toContain(b.token);
  await one.stop();
  const stoppedCalls=calls;expect(await a.client.send({method:'tools/call',token:a.token,call})).toMatchObject({status:'error'});expect(calls).toBe(stoppedCalls);
  const surviving=await b.client.send({method:'tools/call',token:b.token,call});expect(surviving,JSON.stringify(surviving)).toMatchObject({status:'ok',value:{projectId:'p2',packageHash:newer.packageHash}});
  expect(await b.client.send({method:'tools/list',token:a.token})).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
  expect(await b.client.send({method:'tools/list',token:b.token})).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
  await two.stop();await one.cli.exited();await two.cli.exited();
  const previousEndpoint=broker.endpoint,previousGeneration=broker.hostGeneration;
  await broker.close();
  broker=new PrivateApplicationBroker(f.runs,tools);await broker.start();
  expect(broker.endpoint).not.toBe(previousEndpoint);expect(broker.hostGeneration).not.toBe(previousGeneration);
  for(const token of [a.token,b.token]){
   const replay=await peer(broker.endpoint),before=calls;
   expect(await replay.send({method:'tools/call',token,call})).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
   expect(calls).toBe(before);
  }
  // Simulated bridge processes need their owned exit callbacks, just like the fixture CLI.
  await a.bridge.exited();await b.bridge.exited();
  expect(f.runs.get(one.runId).state).toBe('stopped');
  const restored=await f.create();await restored.prepare();await restored.cli.arm();
  reader.identities.set(200003,'darwin-proc-v1:200:200003');await restored.cli.attach(200003);
  const fresh=await authenticate(restored,f.snapshot.mcp[0].serverName);
  expect(fresh.token).not.toBe(a.token);expect(restored.runId).not.toBe(one.runId);
  expect(await fresh.client.send({method:'tools/call',token:fresh.token,call})).toMatchObject({status:'ok',value:{projectId:'p1',taskId:f.snapshot.taskId,packageHash:f.application!.packageHash}});
  await restored.stop();await restored.cli.exited();await fresh.bridge.exited();

 }finally{for(const socket of sockets)socket.destroy();await broker?.close();f.cleanup();}
},30000);

// Production connection authorization is separately exercised by connection-scope.test.ts.
// This synthetic adapter does not establish any connection authorization result.
