// T33 protocol fixture narrowed to one localhost/example.test message.
// No listener exists until startT25Sink is called after resource allocation.
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
export const t25Mail={from:'fixture@example.test',to:'recipient@example.test',subject:'T25 unknown version page authorized',body:'M11_T25_PAGE_AUTHORIZATION_SYNTHETIC_ONLY'};
export async function startT25Sink(){
 const sockets=new Set(),state={connections:0,auth:0,dataAttempts:0,messages:[],errors:[]};
 const server=createServer(socket=>{
  state.connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',e=>state.errors.push(e.code??e.name));socket.setEncoding('utf8');socket.setTimeout(10000,()=>socket.destroy());socket.write('220 t25-loopback ESMTP\r\n');let pending='',data=false,raw=[],from=false,to=false;
  socket.on('data',chunk=>{pending+=chunk;let n;while((n=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+2);
   if(data){if(line!=='.'){raw.push(line.startsWith('..')?line.slice(1):line);continue;}data=false;try{
    assert(from&&to&&state.dataAttempts===1&&state.messages.length===0);const mime=raw.join('\r\n')+'\r\n',subject=/^Subject: (.+)$/m.exec(mime)?.[1]?.trim();assert.equal(subject,t25Mail.subject);assert(mime.includes(t25Mail.body));assert(!/^Cc:|^Bcc:|^Content-Disposition: attachment/im.test(mime));state.messages.push({sha256:createHash('sha256').update(mime).digest('hex'),bytes:Buffer.byteLength(mime),from:t25Mail.from,to:t25Mail.to,subject,at:new Date().toISOString()});socket.write('250 2.0.0 synthetic accepted\r\n');
   }catch(error){state.errors.push(String(error));socket.write('554 synthetic validation failed\r\n');}continue;}
   const command=line.split(' ')[0].toUpperCase();
   if(command==='EHLO')socket.write('250-t25-loopback\r\n250 AUTH PLAIN\r\n');
   else if(command==='AUTH'){state.auth++;socket.write('235 2.7.0 authenticated\r\n');}
   else if(command==='MAIL'){from=line.toLowerCase()==='mail from:<'+t25Mail.from+'>';socket.write(from?'250 OK\r\n':'553 fixed sender only\r\n');}
   else if(command==='RCPT'){to=line.toLowerCase()==='rcpt to:<'+t25Mail.to+'>';socket.write(to?'250 OK\r\n':'553 fixed recipient only\r\n');}
   else if(command==='DATA'){state.dataAttempts++;if(!from||!to||state.dataAttempts>1)socket.write('554 one synthetic message budget\r\n');else{raw=[];data=true;socket.write('354 end with dot\r\n');}}
   else if(command==='QUIT')socket.end('221 bye\r\n');
   else if(command==='RSET'){from=false;to=false;socket.write('250 reset\r\n');}
   else socket.write('250 OK\r\n');
  }});
 });await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
 return{state,port:server.address().port,async close(){for(const s of sockets)s.destroy();await new Promise(ok=>server.close(ok));return{listening:server.listening,remainingSockets:sockets.size};}};
}
