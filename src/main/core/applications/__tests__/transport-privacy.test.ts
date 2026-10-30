import {createServer,type IncomingMessage,type Server,type ServerResponse} from 'node:http';
import type {Socket} from 'node:net';
import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {requestBytes,requestJson} from '../providers/json-http';
import {ZentaoClient} from '../providers/zentao';

let source:Server,sink:Server,base:string,destination:string,sockets:Set<Socket>;
let handle:(request:IncomingMessage,response:ServerResponse)=>void,sourceRequests:number,sinkRequests:number;
const signal=()=>new AbortController().signal;
const canary=()=>`PN_SYNTHETIC_${randomUUID()}_+/=`;
function absent(value:unknown,secrets:string[]){
 const text=typeof value==='string'?value:JSON.stringify(value);
 for(const secret of secrets)for(const variant of [secret,Buffer.from(secret).toString('base64'),encodeURIComponent(secret)])expect(text).not.toContain(variant);
}
async function failure(work:Promise<unknown>,code:string,secrets:string[]){
 const error:unknown=await work.then(()=>{throw new Error('Expected transport rejection');},error=>error);
 expect(error).toMatchObject({code});
 // Error.stack/message are normally non-enumerable; scan those as well as JSON.
 const fields=Object.fromEntries(Object.getOwnPropertyNames(error).map(key=>[key,(error as Record<string,unknown>)[key]]));absent(fields,secrets);
 return error;
}
beforeEach(async()=>{
 sockets=new Set();sourceRequests=0;sinkRequests=0;handle=(_request,response)=>response.end('{}');
 source=createServer((request,response)=>{sourceRequests++;handle(request,response);});
 sink=createServer((_request,response)=>{sinkRequests++;response.end('{}');});
 for(const server of [source,sink]){
  server.on('connection',socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 }
 const address=(server:Server)=>{const address=server.address();if(!address||typeof address==='string')throw new Error('Own fixture port missing');return`http://127.0.0.1:${address.port}`;};base=address(source);destination=address(sink);
});
afterEach(async()=>{
 try{
  // Check the original transport closes its sockets before fixture cleanup.
  await vi.waitFor(()=>expect(sockets.size).toBe(0),{timeout:1000,interval:10});
 }finally{
  const closed=[...sockets].map(socket=>new Promise<void>(resolve=>socket.once('close',()=>resolve())));
  for(const socket of sockets)socket.destroy();await Promise.all(closed);
  await Promise.all([source,sink].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));expect(sockets.size).toBe(0);
 }
});

describe('T08 transport credential boundaries over independent loopback origins',()=>{
 it.each([301,302,303,307,308].flatMap(status=>['GET','POST'].map(method=>({status,method:method as 'GET'|'POST'}))))('does not forward $method authentication across a $status redirect',async({status,method})=>{
  const token=canary(),password=canary();let receivedBody='';
  handle=(request,response)=>{
   expect(request.headers.token).toBe(token);absent(request.url,[token,password]);
   request.setEncoding('utf8');request.on('data',part=>receivedBody+=part);request.on('end',()=>{
    response.writeHead(status,{location:destination+'/capture?credential='+encodeURIComponent(token),'x-echo':password});response.end(token+' '+password);
   });
  };
  await failure(requestJson(new URL('/redirect',base),{method,token,signal:signal(),...(method==='POST'?{body:{account:'pn@example.test',password}}:{})}),'CONNECTION_UNAVAILABLE',[token,password]);
  expect(method==='POST'?JSON.parse(receivedBody):receivedBody).toEqual(method==='POST'?{account:'pn@example.test',password}:'');
  expect(sourceRequests).toBe(1);expect(sinkRequests).toBe(0);
 });

 it.each([{status:401,code:'AUTH_FAILED'},{status:403,code:'SCOPE_DENIED'},{status:404,code:'NOT_FOUND'},{status:429,code:'TRANSIENT_FAILURE'},{status:500,code:'TRANSIENT_FAILURE'},{status:503,code:'TRANSIENT_FAILURE'}])('does not expose echoed credentials in HTTP $status failure',async({status,code})=>{
  const token=canary();handle=(request,response)=>{expect(request.headers.token).toBe(token);response.writeHead(status,{'content-type':'application/json','retry-after':token,'x-echo':token});response.end(JSON.stringify({message:token,authorization:'Token '+token}));};
  await failure(requestJson(new URL('/rejected',base),{token,signal:signal()}),code,[token]);expect(sourceRequests).toBe(1);expect(sinkRequests).toBe(0);
 });

 it.each(['json','utf8','unsafe-number','declared-limit','truncated'] as const)('keeps a credential-bearing %s response out of parsing and transport errors',async kind=>{
  const token=canary();handle=(_request,response)=>{
   response.setHeader('content-type','application/json');
   if(kind==='declared-limit'){response.setHeader('content-length','10000');response.end(token);}
   else if(kind==='truncated'){response.setHeader('content-length','10000');response.flushHeaders();response.write(token);response.end();}
   else if(kind==='utf8')response.end(Buffer.concat([Buffer.from('{"echo":"'+token+'"}'),Buffer.from([0xff])]));
   else if(kind==='unsafe-number')response.end(JSON.stringify({echo:token}).slice(0,-1)+',"id":9007199254740997}');
   else response.end('{"echo":"'+token+'",');
  };
  const code=kind==='declared-limit'?'INCOMPLETE_RESULT':kind==='truncated'?'TRANSIENT_FAILURE':'INVALID_RESPONSE';
  await failure(requestJson(new URL('/malformed',base),{token,signal:signal(),timeoutMs:1000,...(kind==='declared-limit'?{maxBytes:100}:{})}),code,[token]);expect(sourceRequests).toBe(1);expect(sinkRequests).toBe(0);
 });

 it('uses the password only in the login body and the returned token only in the subsequent authentication header',async()=>{
  const password=canary(),token=canary();const receipts:{path:string;header:string|undefined;body:string}[]=[];
  handle=(request,response)=>{
   let body='';request.setEncoding('utf8');request.on('data',part=>body+=part);request.on('end',()=>{
    const path=request.url!;absent(path,[password,token]);receipts.push({path,header:request.headers.token as string|undefined,body});response.setHeader('content-type','application/json');
    if(path==='/biz/api.php/v1/tokens'){expect(request.headers.token).toBeUndefined();expect(JSON.parse(body)).toEqual({account:'pn-tester',password});response.end(JSON.stringify({token}));}
    else{expect(path).toBe('/biz/api.php/v1/user');expect(request.headers.token).toBe(token);expect(body).toBe('');response.end(JSON.stringify({profile:{id:1,account:'pn-tester'}}));}
   });
  };
  const client=new ZentaoClient({kind:'zentao',baseUrl:base+'/biz/',username:'pn-tester',authMode:'password'},password);
  try{const identity=await client.verify(signal());absent(identity,[password,token]);expect(identity).toMatchObject({providerId:'zentao',accountId:'uid:1'});expect(receipts).toHaveLength(2);expect(sourceRequests).toBe(2);expect(sinkRequests).toBe(0);}finally{client.close();}
 });

 it('rejects URL userinfo and a header-breaking token before opening a connection',async()=>{
  const secret=canary();expect(()=>requestBytes(new URL('http://name:'+encodeURIComponent(secret)+'@127.0.0.1/'),{signal:signal()})).toThrow('服务地址无效');
  expect(()=>requestBytes(new URL('/not-sent',base),{token:secret+'\r\nInjected: header',signal:signal()})).toThrow('Token格式无效');expect(sourceRequests).toBe(0);expect(sinkRequests).toBe(0);
 });
});
