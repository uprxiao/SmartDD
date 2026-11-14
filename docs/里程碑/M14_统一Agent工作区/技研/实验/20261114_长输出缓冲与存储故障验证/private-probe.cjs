const {CodexPrivateServer}=require('./actual-private.cjs');const {EventEmitter}=require('node:events');const assert=require('node:assert/strict');const {writeFileSync}=require('node:fs');
function setup(){const actual=Object.create(CodexPrivateServer.prototype);actual.responseBytes=0;actual.requests=new Map();let stops=0;actual.stop=async()=>{stops++};const socket=new EventEmitter();const sent=[];socket.send=s=>sent.push(JSON.parse(s));actual.listen(socket);return{actual,socket,sent,stops:()=>stops};}
const results=[];
{
 const f=setup(),raw=Buffer.from(JSON.stringify({method:'fixture.delta',params:{text:'中'.repeat(2048)}}));let count=0,rejected;
 f.actual.requests.set(1,{timer:undefined,resolve:()=>{throw Error('unexpected resolution')},reject:e=>{rejected=e.code}});
 while(f.stops()===0&&count<2000){f.socket.emit('message',raw);count++;}
 assert.equal(f.stops(),1);assert(raw.length<4*1024*1024);assert((count-1)*raw.length<=8*1024*1024);assert(count*raw.length>8*1024*1024);assert.equal(rejected,'INVALID_RESPONSE');assert.equal(f.actual.requests.size,0);
 results.push({id:'C01-actual-control-lifetime-budget-not-per-message',passed:true,frames:count,frameBytes:raw.length,totalBytes:count*raw.length,rejected});
}
{
 const f=setup();f.socket.emit('message',Buffer.from(JSON.stringify({id:33,method:'fixture.approval',params:{}})));assert.equal(f.stops(),0);assert.equal(f.sent[0].error.code,-32601);
 results.push({id:'C02-control-connection-does-not-approve-interactive-requests',passed:true});
}
writeFileSync(__dirname+'/private-result.json',JSON.stringify({scope:'Actual CodexPrivateServer.listen/rejectRequests only, constructor bypassed; EventEmitter socket and stop mocked, no process/OS endpoint/native version checks executed.',results},null,2));console.log(JSON.stringify({passed:results.length}));
