import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createServer,type Server} from 'node:http';
import {existsSync} from 'node:fs';
import {once} from 'node:events';
import WebSocket,{WebSocketServer} from 'ws';
import {PrivateAgentEndpoint} from '../private-agent-endpoint';
import {CodexResumeRelay} from '../codex-resume-relay';

const id='01a1cc33-e59f-7311-8924-144540948a80';
let native:PrivateAgentEndpoint,http:Server,server:WebSocketServer,relay:CodexResumeRelay,client:WebSocket|undefined,peer:WebSocket|undefined,allowed:boolean;
let nativeFrames:string[],clientFrames:string[],receipts:unknown[];
beforeEach(async()=>{
 allowed=true;nativeFrames=[];clientFrames=[];receipts=[];native=new PrivateAgentEndpoint({storeId:'synthetic-relay-test',runId:crypto.randomUUID()});http=createServer();server=new WebSocketServer({noServer:true});
 http.on('upgrade',(r,s,h)=>server.handleUpgrade(r,s,h,p=>server.emit('connection',p)));
 server.on('connection',p=>{peer=p;p.on('error',()=>{});p.on('message',b=>{const raw=b.toString();nativeFrames.push(raw);const m=JSON.parse(raw);if(m.method==='initialize')p.send(JSON.stringify({id:m.id,result:{}}));});});
 await new Promise<void>(resolve=>http.listen(native.path,resolve));native.verifySocket();
 relay=new CodexResumeRelay({storeId:'synthetic-relay-test',runId:crypto.randomUUID(),threadId:id,upstream:native.url,verifyUpstream:()=>native.verifySocket(),permissions:()=>({approvalPolicy:'on-request',sandbox:'read-only',config:{approval_policy:'on-request',sandbox_mode:'read-only'}}),allow:()=>allowed,observe:r=>receipts.push(r)});await relay.start();
});
afterEach(async()=>{client?.terminate();await relay.stop();for(const p of server.clients)p.terminate();server.close();await new Promise<void>(resolve=>http.close(()=>resolve()));native.release();client=undefined;peer=undefined;});
async function connect(){client=new WebSocket('ws+unix://'+relay.endpoint.path+':/rpc');client.on('error',()=>{});client.on('message',b=>clientFrames.push(b.toString()));await once(client,'open');client.send('{"id":1,"method":"initialize","params":{"clientInfo":{"name":"synthetic"}}}');await vi.waitFor(()=>expect(clientFrames).toHaveLength(1));return client;}

describe.skipIf(process.platform!=='darwin')('per-run Codex permission relay, synthetic native protocol (no model)',()=>{
 it('changes only the exact initial resume, preserves native IDs, history/model fields and unrelated config',async()=>{
  const c=await connect();c.send(JSON.stringify({id:2,method:'thread/resume',params:{threadId:id,model:'synthetic',excludeTurns:true,initialTurnsPage:{limit:5},config:{model_reasoning_effort:'low'}}}));await vi.waitFor(()=>expect(nativeFrames).toHaveLength(2));
  expect(JSON.parse(nativeFrames[1])).toEqual({id:2,method:'thread/resume',params:{threadId:id,model:'synthetic',excludeTurns:true,initialTurnsPage:{limit:5},approvalPolicy:'on-request',sandbox:'read-only',config:{model_reasoning_effort:'low',approval_policy:'on-request',sandbox_mode:'read-only'}}});
  peer!.send(JSON.stringify({id:2,result:{thread:{id},approvalPolicy:'on-request',sandbox:{type:'read-only'}}}));await vi.waitFor(()=>expect(clientFrames).toHaveLength(2));expect(receipts).toHaveLength(2);
 });
 it('forwards approval requests and user refusal byte-for-byte; never answers them itself',async()=>{
  const c=await connect(),request='{ "id": "approve-qa", "method": "item/commandExecution/requestApproval", "params": {"threadId":"'+id+'","command":"synthetic"} }';peer!.send(request);await vi.waitFor(()=>expect(clientFrames.at(-1)).toBe(request));expect(nativeFrames).toHaveLength(1);
  const refusal='{ "id": "approve-qa", "result": { "decision": "decline" } }';c.send(refusal);await vi.waitFor(()=>expect(nativeFrames.at(-1)).toBe(refusal));expect(receipts).toEqual([]);
 });
 it('keeps the selected permissions on a native retry after the initial resume returns an error',async()=>{
  const c=await connect();c.send(JSON.stringify({id:2,method:'thread/resume',params:{threadId:id}}));await vi.waitFor(()=>expect(nativeFrames).toHaveLength(2));
  peer!.send(JSON.stringify({id:2,error:{code:-32000,message:'Synthetic transient preparation failure'}}));await vi.waitFor(()=>expect(clientFrames).toHaveLength(2));
  c.send(JSON.stringify({id:3,method:'thread/resume',params:{threadId:id}}));await vi.waitFor(()=>expect(nativeFrames).toHaveLength(3));
  expect(JSON.parse(nativeFrames[2]).params).toMatchObject({threadId:id,approvalPolicy:'on-request',sandbox:'read-only'});
 });
 it('does not confuse an incoming approval request with the same ID as the pending resume response',async()=>{
  const c=await connect();c.send(JSON.stringify({id:2,method:'thread/resume',params:{threadId:id}}));await vi.waitFor(()=>expect(nativeFrames).toHaveLength(2));
  const approval=JSON.stringify({id:2,method:'item/commandExecution/requestApproval',params:{threadId:id,command:'synthetic'}});peer!.send(approval);await vi.waitFor(()=>expect(clientFrames.at(-1)).toBe(approval));expect(receipts).toHaveLength(1);
  peer!.send(JSON.stringify({id:2,result:{thread:{id},approvalPolicy:'on-request',sandbox:{type:'read-only'}}}));await vi.waitFor(()=>expect(receipts).toHaveLength(2));expect(receipts[1]).toMatchObject({result:{thread:{id},approvalPolicy:'on-request'}});
 });
 it('rejects a success response for a different native history instead of acknowledging the wrong task',async()=>{
  const c=await connect();c.send(JSON.stringify({id:2,method:'thread/resume',params:{threadId:id}}));await vi.waitFor(()=>expect(nativeFrames).toHaveLength(2));const ended=once(c,'close');
  peer!.send(JSON.stringify({id:2,result:{thread:{id:'01a1cc33-e59f-7311-8924-144540948a81'},approvalPolicy:'never',sandbox:{type:'workspace-write'}}}));await ended;
  expect(clientFrames).toHaveLength(1);expect(receipts).toHaveLength(1);
 });
 it.each([{threadId:'01a1cc33-e59f-7311-8924-144540948a81'},{threadId:id,history:[]},{threadId:id,path:'/synthetic/other-history'}])('rejects a substituted first resume target %j without forwarding it',async params=>{
  const c=await connect(),ended=once(c,'close');c.send(JSON.stringify({id:2,method:'thread/resume',params}));await ended;expect(nativeFrames).toHaveLength(1);expect(receipts).toEqual([]);
 });
 it('revokes forwarding when the owning run stops and removes only its marked endpoint',async()=>{
  const c=await connect(),ended=once(c,'close');allowed=false;c.send('{"id":3,"method":"turn/start","params":{}}');await ended;expect(nativeFrames).toHaveLength(1);const path=relay.endpoint.directory;await relay.stop();expect(existsSync(path)).toBe(false);
 });
});
