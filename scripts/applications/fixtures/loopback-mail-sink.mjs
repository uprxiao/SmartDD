// TL: one-message, non-relaying SMTP fixture. Default is unarmed/zero DATA.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
export const TL_MAIL=Object.freeze({from:'sender@willyou.invalid',to:'recipient@willyou.invalid',subject:'WILLYOU_M10_LOOPBACK_TL_20261029',text:'WILLYOU_M10_LOOPBACK_TL_20261029'});
const sha=b=>createHash('sha256').update(b).digest('hex');
export function validateTlMime(raw){
 assert(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=131072,'Bounded MIME bytes');
 const text=raw.toString('utf8'),at=text.indexOf('\r\n\r\n');assert(at>0,'CRLF MIME header separator');
 const headers=new Map();for(const line of text.slice(0,at).replace(/\r\n[\t ]+/g,' ').split('\r\n')){const i=line.indexOf(':');assert(i>0,'MIME header');const name=line.slice(0,i).toLowerCase(),value=line.slice(i+1).trim();assert(!headers.has(name),'Duplicate MIME header');headers.set(name,value);}
 const address=v=>v?.replace(/^<([^<>]+)>$/,'$1');assert.equal(address(headers.get('from')),TL_MAIL.from);assert.equal(address(headers.get('to')),TL_MAIL.to);assert.equal(headers.get('subject'),TL_MAIL.subject);assert(/^<[^<>\s]+>$/.test(headers.get('message-id')??''),'Message-ID required');
 for(const name of ['cc','bcc','reply-to','sender','in-reply-to','references'])assert(!headers.has(name),'Unexpected '+name);
 assert(/^text\/plain(?:;|$)/i.test(headers.get('content-type')??''),'Only plain text and no attachments/HTML');
 let body=text.slice(at+4);const encoding=(headers.get('content-transfer-encoding')??'7bit').toLowerCase();
 if(encoding==='base64'){const b=body.replace(/\r\n/g,'');assert(/^[A-Za-z0-9+/]*={0,2}$/.test(b)&&b.length%4===0);const bytes=Buffer.from(b,'base64');assert.equal(bytes.toString('base64'),b);body=bytes.toString('utf8');}
 else if(encoding==='quoted-printable'){assert(!/=(?![a-fA-F0-9]{2}|\r\n)/.test(body));body=body.replace(/=\r\n/g,'').replace(/=([a-fA-F0-9]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)));}
 else assert(['7bit','8bit'].includes(encoding),'Unsupported body encoding');
 assert([TL_MAIL.text,TL_MAIL.text+'\r\n',TL_MAIL.text+'\n'].includes(body),'Exact fixed test body only');
 return{from:TL_MAIL.from,to:[TL_MAIL.to],subject:TL_MAIL.subject,textSha256:sha(TL_MAIL.text),messageId:headers.get('message-id'),rawHash:sha(raw),bytes:raw.length,attachments:0};
}
export async function startTlMailSink({root,armed=false,onceBudgetPath=null}){
 assert(root.startsWith('/private/tmp/willyou-m10-tl-'),'Own TL temporary root');assert.equal(typeof armed,'boolean');await mkdir(root,{recursive:true});const secret=randomBytes(32).toString('base64url'),sockets=new Set();let serial=0,chain=Promise.resolve(),closed=false;
 assert(onceBudgetPath===null||/^\/private\/tmp\/willyou-m10-tl-20261029\/once-[a-f0-9]{64}\.json$/.test(onceBudgetPath),'Exact per-approval budget path');assert(!armed||onceBudgetPath,'Armed sender requires persistent one-DATA budget');
 const state={schema:1,startedAt:new Date().toISOString(),host:'127.0.0.1',port:null,armed,onceBudgetPath,counts:{authAccepted:0,authRejected:0,mailAccepted:0,mailRejected:0,rcptAccepted:0,rcptRejected:0,dataCommands:0,acceptedMessages:0,rejectedMessages:0,extraDataAttempts:0},records:[],accepted:[]};
 const persist=async()=>{const tmp=join(root,'smtp-events.pending.json');await writeFile(tmp,JSON.stringify(state,null,2),{mode:0o600});await rename(tmp,join(root,'smtp-events.json'));};
 const record=(socket,command,detail={})=>{state.records.push({socket,command,...detail,at:new Date().toISOString()});assert(state.records.length<=256,'Bounded SMTP commands');};
 const server=createServer(socket=>{const id=++serial;let authenticated=false,from=null,to=[],inData=false,bytes=0,lines=[],buffer='';sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));socket.setTimeout(10000,()=>socket.destroy());const send=s=>{if(!socket.destroyed)socket.write(s+'\r\n');};send('220 TL isolated non-relaying SMTP');
  const handle=async line=>{if(socket.destroyed)return;if(inData){if(line!=='.'){const value=line.startsWith('..')?line.slice(1):line;bytes+=Buffer.byteLength(value)+2;if(bytes>131072){state.counts.rejectedMessages++;record(id,'DATA-REJECT',{reason:'oversize'});socket.destroy();return;}lines.push(value);return;}inData=false;const raw=Buffer.from(lines.join('\r\n')+'\r\n');lines=[];try{assert(armed&&authenticated&&from===TL_MAIL.from&&to.length===1&&to[0]===TL_MAIL.to);assert.equal(state.counts.acceptedMessages,0,'One DATA maximum');const verified=validateTlMime(raw);state.counts.acceptedMessages++;state.accepted.push({...verified,at:new Date().toISOString()});record(id,'DATA-ACCEPT',{rawHash:verified.rawHash,messageId:verified.messageId});await writeFile(join(root,'accepted-message.eml'),raw,{mode:0o600,flag:'wx'});await persist();socket.destroy();}catch{state.counts.rejectedMessages++;record(id,'DATA-REJECT',{reason:'scope-or-content'});send('550 Fixed TL scope rejected');await persist();}return;}
   const command=line.split(' ',1)[0].toUpperCase();if(command==='EHLO'||command==='HELO'){record(id,command);socket.write('250-TL isolated fixture\r\n250 AUTH PLAIN\r\n');}
   else if(command==='AUTH'){let good=false;if(line.startsWith('AUTH PLAIN ')){const fields=Buffer.from(line.slice(11),'base64').toString('utf8').split('\0');good=fields.length===3&&fields[1]===TL_MAIL.from&&fields[2]===secret;}authenticated=good;state.counts[good?'authAccepted':'authRejected']++;record(id,'AUTH',{accepted:good});send(good?'235 Authenticated':'535 Rejected');}
   else if(command==='MAIL'){from=null;to=[];const m=/^MAIL FROM:<([^<>]+)>$/i.exec(line),good=authenticated&&m?.[1]===TL_MAIL.from;state.counts[good?'mailAccepted':'mailRejected']++;if(good)from=m[1];record(id,'MAIL',{accepted:!!good});send(good?'250 Sender accepted':'553 Sender rejected');}
   else if(command==='RCPT'){const m=/^RCPT TO:<([^<>]+)>$/i.exec(line),good=authenticated&&from===TL_MAIL.from&&to.length===0&&m?.[1]===TL_MAIL.to;state.counts[good?'rcptAccepted':'rcptRejected']++;if(good)to.push(m[1]);record(id,'RCPT',{accepted:!!good});send(good?'250 Recipient accepted':'553 Recipient rejected');}
   else if(command==='DATA'){state.counts.dataCommands++;const consumed=onceBudgetPath&&existsSync(onceBudgetPath);if(state.counts.acceptedMessages>0||consumed)state.counts.extraDataAttempts++;let good=armed&&authenticated&&from===TL_MAIL.from&&to.length===1&&state.counts.acceptedMessages===0&&!consumed;if(good){try{await writeFile(onceBudgetPath,JSON.stringify({schema:1,scope:'TL_20261029',stage:'DATA_PERMITTED',root,socket:id,plannedMailHash:sha(JSON.stringify(TL_MAIL)),at:new Date().toISOString()},null,2),{mode:0o600,flag:'wx'});}catch(error){good=false;if(error.code!=='EEXIST')throw error;}}record(id,'DATA',{permitted:good});if(good){inData=true;bytes=0;lines=[];send('354 End with dot');}else{state.counts.rejectedMessages++;send('554 Not authorized or fixed scope already consumed');}}
   else if(command==='RSET'){from=null;to=[];record(id,'RSET');send('250 Reset');}
   else if(command==='NOOP'){record(id,'NOOP');send('250 OK');}
   else if(command==='QUIT'){record(id,'QUIT');socket.end('221 Bye\r\n');}
   else{record(id,'UNSUPPORTED');send('500 Unsupported command');}
   await persist();
  };
  socket.on('data',chunk=>{buffer+=chunk.toString('utf8');if(buffer.length>140000){socket.destroy();return;}while(buffer.includes('\r\n')){const i=buffer.indexOf('\r\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+2);chain=chain.then(()=>handle(line)).catch(()=>socket.destroy());}});
 });server.maxConnections=4;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const address=server.address();assert(address&&typeof address!=='string'&&address.address==='127.0.0.1');state.port=address.port;await persist();return{config:Object.freeze({kind:'smtp',host:'127.0.0.1',port:address.port,username:TL_MAIL.from,fromAddress:TL_MAIL.from,authMode:'password',mode:'plain'}),getPrivateSecret:()=>secret,state:()=>structuredClone(state),assertPublic:text=>assert(!text.includes(secret),'Private synthetic SMTP secret in public evidence'),close:async()=>{if(closed)return;closed=true;for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await chain;state.closedAt=new Date().toISOString();await persist();}};
}
export function assertTlConsent(value){
 assert(value&&value.source==='explicit-user-reply'&&value.scope==='TL_20261029'&&value.allowOneLoopbackData===true,'Explicit scoped user reply required');assert.equal(value.maxData,1);assert.equal(value.allowRealMailbox,false);assert.deepEqual(value.mail,TL_MAIL);assert.equal(typeof value.questionReference,'string');assert(value.questionReference.length>10&&value.questionReference.length<2000);assert.equal(typeof value.rawUserAnswer,'string');assert(value.rawUserAnswer.trim(),'Actual user answer required');return Object.freeze(structuredClone(value));
}
