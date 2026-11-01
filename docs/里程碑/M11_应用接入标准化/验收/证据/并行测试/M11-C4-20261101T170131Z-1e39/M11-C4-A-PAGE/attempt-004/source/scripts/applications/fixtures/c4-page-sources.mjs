import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {createServer as netServer} from 'node:net';
import {createHash} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
export const fixture={account:'fixture@example.test',recipient:'recipient@example.test',subject:'M11 C4 page-only synthetic send',text:'M11_C4_PAGE_SYNTHETIC_BODY',bugId:'79291',bugTitle:'C4 synthetic assigned Bug',bugBody:'C4_SYNTHETIC_BUG_BODY',history:'C4_SYNTHETIC_BUG_HISTORY',mailSubject:'C4 synthetic received mail',mailBody:'C4_SYNTHETIC_RECEIVED_BODY'};
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function prepareSource(root){
 const source=join(root,fixture.account);await mkdir(join(source,'Mail/Inbox'),{recursive:true});
 await writeFile(join(source,'Mail/Inbox/1.mail'),'Date: '+new Date().toUTCString()+'\r\nFrom: sender@example.test\r\nTo: '+fixture.account+'\r\nSubject: '+fixture.mailSubject+'\r\nMessage-ID: <c4-received@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+fixture.mailBody+'\r\n');
 execFileSync('/usr/bin/sqlite3',[join(source,'messages.db'),"CREATE TABLE mailinfo(mailid INTEGER PRIMARY KEY,subject TEXT,from_ TEXT,to_ TEXT,messageid TEXT,date INTEGER,mail_receivedate INTEGER,fileexist INTEGER,attachment INTEGER);INSERT INTO mailinfo VALUES(1,'C4 synthetic received mail','sender@example.test','fixture@example.test','<c4-received@example.test>',0,0,1,0);"],{timeout:5000});return source;
}
export async function sourceHashes(source){return Object.fromEntries(await Promise.all(['messages.db','Mail/Inbox/1.mail'].map(async p=>[p,sha(await readFile(join(source,p)))])));}
export async function startSources(ports={}){
 const sockets=new Set(),httpCalls=[],smtpState={connections:0,auth:0,dataAttempts:0,messages:[],errors:[]};
 const zentao=httpServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');httpCalls.push({path:u.pathname,query:u.search,at:new Date().toISOString()});const json=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(req.headers.token!=='synthetic-c4-zt-token')return json({},401);
  if(u.pathname.endsWith('/v1/user'))return json({profile:{id:'7',account:'tester'}});
  if(u.pathname.endsWith('/v1/langs'))return json({bug:{statusList:{active:'激活'},priList:{3:'P2'},severityList:{3:'较大'}}});
  if(u.pathname.endsWith('/v2/my/work')){const kind=u.searchParams.get('mode'),rows=kind==='bug'?[{id:fixture.bugId,title:fixture.bugTitle,status:'active',assignedTo:{account:'tester'}}]:[];return json({mode:kind,type:'assignedTo',pager:{recTotal:rows.length,pageID:1,recPerPage:Number(u.searchParams.get('recPerPage')),pageTotal:rows.length?1:0},[kind==='bug'?'bugs':'stories']:rows});}
  if(u.pathname.endsWith('/v1/bugs/'+fixture.bugId))return json({bug:{id:fixture.bugId,title:fixture.bugTitle,status:'active',pri:3,severity:3,assignedTo:{account:'tester'},product:{id:'96',name:'C4 synthetic product'},steps:'<p>'+fixture.bugBody+'</p>',files:[]},actions:[{action:'opened',comment:fixture.history}]});
  json({},404);
 });
 const smtp=netServer(socket=>{smtpState.connections++;socket.setEncoding('utf8');socket.setTimeout(10000,()=>socket.destroy());socket.on('error',e=>smtpState.errors.push(e.code??e.name));socket.write('220 c4-loopback ESMTP\r\n');let pending='',data=false,raw=[],from=false,to=false;
  socket.on('data',chunk=>{pending+=chunk;if(pending.length>262144)return socket.destroy();let n;while((n=pending.indexOf('\r\n'))>=0){const line=pending.slice(0,n);pending=pending.slice(n+2);
   if(data){if(line!=='.'){raw.push(line.startsWith('..')?line.slice(1):line);continue;}data=false;try{assert(from&&to);assert.equal(smtpState.messages.length,0);const mime=raw.join('\r\n')+'\r\n';assert(mime.includes(fixture.account)&&mime.includes(fixture.recipient));assert(mime.includes('Subject: '+fixture.subject));assert(mime.includes(fixture.text));assert(!/^Cc:|^Bcc:|^Content-Disposition: attachment/im.test(mime));smtpState.messages.push({sha256:sha(mime),bytes:Buffer.byteLength(mime),from:fixture.account,to:fixture.recipient,subject:fixture.subject,text:fixture.text,acceptedAt:new Date().toISOString()});socket.write('250 2.0.0 synthetic accepted\r\n');}catch(e){smtpState.errors.push(String(e));socket.write('554 fixture validation failed\r\n');}continue;}
   const cmd=line.split(' ')[0].toUpperCase();if(cmd==='EHLO')socket.write('250-c4-loopback\r\n250 AUTH PLAIN\r\n');else if(cmd==='AUTH'){smtpState.auth++;socket.write('235 2.7.0 authenticated\r\n');}else if(cmd==='MAIL'){from=line.toLowerCase()==='mail from:<'+fixture.account+'>';socket.write(from?'250 OK\r\n':'553 fixture sender only\r\n');}else if(cmd==='RCPT'){to=line.toLowerCase()==='rcpt to:<'+fixture.recipient+'>';socket.write(to?'250 OK\r\n':'553 fixture target only\r\n');}else if(cmd==='DATA'){smtpState.dataAttempts++;if(!from||!to||smtpState.dataAttempts!==1)socket.write('554 one bounded synthetic message only\r\n');else{raw=[];data=true;socket.write('354 end with dot\r\n');}}else if(cmd==='QUIT')socket.end('221 bye\r\n');else if(cmd==='RSET'){from=false;to=false;socket.write('250 reset\r\n');}else socket.write('250 OK\r\n');
  }});
 });
 for(const [server,port]of [[zentao,ports.zentao??0],[smtp,ports.smtp??0]]){server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});}
 return{httpCalls,smtpState,zentaoPort:zentao.address().port,smtpPort:smtp.address().port,async close(){for(const s of sockets)s.destroy();await Promise.all([zentao,smtp].map(s=>new Promise(ok=>s.close(ok))));return{httpListening:zentao.listening,smtpListening:smtp.listening,ownedSockets:sockets.size};}};
}
