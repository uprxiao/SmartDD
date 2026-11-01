import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
export const senderFixture={from:'fixture@example.test',to:'recipient@example.test',body:'M11_C4_SENDER_SYNTHETIC_BODY',subjects:['T33 SMTP initial','T33 SMTP reconfirmed','T33 matching reconfirmed','T33 Foxmail reconfirmed'],sourceBody:'T33_SYNTHETIC_READ_REMAINS_AVAILABLE'};
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function prepareSenderSource(root,label){
 const source=join(root,label,senderFixture.from);await mkdir(join(source,'Mail/Inbox'),{recursive:true});
 await writeFile(join(source,'Mail/Inbox/1.mail'),'Date: '+new Date().toUTCString()+'\r\nFrom: sender@example.test\r\nTo: '+senderFixture.from+'\r\nSubject: T33 received '+label+'\r\nMessage-ID: <t33-'+label+'@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+senderFixture.sourceBody+' '+label+'\r\n');
 execFileSync('/usr/bin/sqlite3',[join(source,'messages.db'),"CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER);INSERT INTO mailinfo VALUES(1,'T33 received "+label+"','sender@example.test','fixture@example.test','<t33-"+label+"@example.test>',0,0,1,0);"],{timeout:5000});return source;
}
export async function senderSourceHashes(source){return Object.fromEntries(await Promise.all(['messages.db','Mail/Inbox/1.mail'].map(async p=>[p,sha(await readFile(join(source,p)))])));}
export async function startSenderSink(port=0){
 const sockets=new Set(),state={connections:0,auth:0,dataAttempts:0,messages:[],errors:[]};
 const server=createServer(socket=>{state.connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',e=>state.errors.push(e.code??e.name));socket.setEncoding('utf8');socket.setTimeout(10000,()=>socket.destroy());socket.write('220 t33-loopback ESMTP\r\n');let pending='',data=false,raw=[],from=false,to=false;
  socket.on('data',chunk=>{pending+=chunk;if(pending.length>262144)return socket.destroy();let n;while((n=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+2);
   if(data){if(line!=='.'){raw.push(line.startsWith('..')?line.slice(1):line);continue;}data=false;try{assert(from&&to);const mime=raw.join('\r\n')+'\r\n',subject=/^Subject: (.+)$/m.exec(mime)?.[1]?.trim();assert(senderFixture.subjects.includes(subject));assert(!state.messages.some(m=>m.subject===subject));assert(mime.includes(senderFixture.body));assert(!/^Cc:|^Bcc:|^Content-Disposition: attachment/im.test(mime));state.messages.push({sha256:sha(mime),bytes:Buffer.byteLength(mime),from:senderFixture.from,to:senderFixture.to,subject,at:new Date().toISOString()});socket.write('250 2.0.0 synthetic accepted\r\n');}catch(e){state.errors.push(String(e));socket.write('554 synthetic validation failed\r\n');}continue;}
   const cmd=line.split(' ')[0].toUpperCase();if(cmd==='EHLO')socket.write('250-t33-loopback\r\n250 AUTH PLAIN\r\n');else if(cmd==='AUTH'){state.auth++;socket.write('235 2.7.0 authenticated\r\n');}else if(cmd==='MAIL'){from=line.toLowerCase()==='mail from:<'+senderFixture.from+'>';socket.write(from?'250 OK\r\n':'553 fixed sender only\r\n');}else if(cmd==='RCPT'){to=line.toLowerCase()==='rcpt to:<'+senderFixture.to+'>';socket.write(to?'250 OK\r\n':'553 fixed target only\r\n');}else if(cmd==='DATA'){state.dataAttempts++;if(!from||!to||state.dataAttempts>4)socket.write('554 bounded synthetic send budget\r\n');else{raw=[];data=true;socket.write('354 end with dot\r\n');}}else if(cmd==='QUIT')socket.end('221 bye\r\n');else if(cmd==='RSET'){from=false;to=false;socket.write('250 reset\r\n');}else socket.write('250 OK\r\n');
  }});
 });await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});
 return{state,port:server.address().port,async close(){for(const s of sockets)s.destroy();await new Promise(ok=>server.close(ok));return{listening:server.listening,sockets:sockets.size};}};
}
