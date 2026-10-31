// T18: loopback-only SMTP sink that accepts multi-recipient mail with attachments and answers 250 (normal receipt).
// Non-relaying, 127.0.0.1 only; at most one accepted DATA, enforced by a persistent per-approval budget file.
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {TL_MAIL} from './loopback-mail-sink.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const ADDRESS=/^[a-z0-9._-]+@willyou\.invalid$/;

export function parseMime(raw){
 const text=raw.toString('utf8'),at=text.indexOf('\r\n\r\n');assert(at>0,'CRLF MIME header separator');
 const headers=new Map();
 for(const line of text.slice(0,at).replace(/\r\n[\t ]+/g,' ').split('\r\n')){const i=line.indexOf(':');assert(i>0,'MIME header');headers.set(line.slice(0,i).toLowerCase(),line.slice(i+1).trim());}
 const contentType=headers.get('content-type')??'',boundary=/boundary="?([^";]+)"?/i.exec(contentType)?.[1]??null,parts=[];
 if(boundary){
  for(const chunk of text.slice(at+4).split('--'+boundary).slice(1)){
   if(chunk.startsWith('--'))break;
   const body=chunk.replace(/^\r\n/,''),cut=body.indexOf('\r\n\r\n'),head=body.slice(0,cut).replace(/\r\n[\t ]+/g,' '),ph=new Map();
   for(const line of head.split('\r\n')){const i=line.indexOf(':');if(i>0)ph.set(line.slice(0,i).toLowerCase(),line.slice(i+1).trim());}
   let data=body.slice(cut+4).replace(/\r\n$/,'');
   const encoding=(ph.get('content-transfer-encoding')??'7bit').toLowerCase();
   const bytes=encoding==='base64'?Buffer.from(data.replace(/\r\n/g,''),'base64'):Buffer.from(data,'utf8');
   const name=/filename\*?="?([^";]+)"?/i.exec(ph.get('content-disposition')??'')?.[1]??null;
   parts.push({contentType:ph.get('content-type')??'',filename:name,bytes:bytes.length,sha256:sha(bytes),text:name?null:bytes.toString('utf8')});
  }
 }
 if(!boundary){const enc=(headers.get('content-transfer-encoding')??'7bit').toLowerCase(),body=text.slice(at+4);const bytes=enc==='base64'?Buffer.from(body.replace(/\r\n/g,''),'base64'):Buffer.from(enc==='quoted-printable'?body.replace(/=\r\n/g,'').replace(/=([a-fA-F0-9]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16))):body,'utf8');parts.push({contentType,filename:null,bytes:bytes.length,sha256:sha(bytes),text:bytes.toString('utf8')});}
 return{headers:Object.fromEntries(headers),parts,rawHash:sha(raw),bytes:raw.length};
}

export async function startT18MailSink({root,armed=false,onceBudgetPath=null,maxRecipients=4,receiptDelayMs=0}){
 assert(root.startsWith('/private/tmp/willyou-m10-tl-'),'Own TL temporary root');
 await mkdir(root,{recursive:true});
 assert(onceBudgetPath===null||/^\/private\/tmp\/willyou-m10-tl-20261029\/once-[a-f0-9]{64}\.json$/.test(onceBudgetPath),'Exact per-approval budget path');
 assert(!armed||onceBudgetPath,'Armed sender requires persistent one-DATA budget');
 const secret=randomBytes(32).toString('base64url'),sockets=new Set();let serial=0,chain=Promise.resolve(),closed=false;
 const state={schema:1,kind:'t18',startedAt:new Date().toISOString(),host:'127.0.0.1',port:null,armed,onceBudgetPath,counts:{authAccepted:0,authRejected:0,mailAccepted:0,mailRejected:0,rcptAccepted:0,rcptRejected:0,dataCommands:0,acceptedMessages:0,rejectedMessages:0,extraDataAttempts:0},records:[],accepted:[]};
 const persist=async()=>{const tmp=join(root,'smtp-events.pending.json');await writeFile(tmp,JSON.stringify(state,null,2),{mode:0o600});await rename(tmp,join(root,'smtp-events.json'));};
 const record=(socket,command,detail={})=>{state.records.push({socket,command,...detail,at:new Date().toISOString()});assert(state.records.length<=256,'Bounded SMTP commands');};
 const server=createServer(socket=>{
  const id=++serial;let authenticated=false,from=null,to=[],inData=false,bytes=0,lines=[],buffer='';
  sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));
  const send=text=>{if(!socket.destroyed)socket.write(text+'\r\n');};
  send('220 T18 isolated non-relaying SMTP');
  const handle=async line=>{
   if(socket.destroyed)return;
   if(inData){
    if(line!=='.'){const value=line.startsWith('..')?line.slice(1):line;bytes+=Buffer.byteLength(value)+2;if(bytes>2000000){state.counts.rejectedMessages++;record(id,'DATA-REJECT',{reason:'oversize'});socket.destroy();return;}lines.push(value);return;}
    inData=false;const raw=Buffer.from(lines.join('\r\n')+'\r\n');lines=[];
    try{
     assert(armed&&authenticated&&from===TL_MAIL.from&&to.length>=1);
     assert.equal(state.counts.acceptedMessages,0,'One DATA maximum');
     const parsed=parseMime(raw);
     state.counts.acceptedMessages++;state.accepted.push({envelopeFrom:from,envelopeTo:[...to],...parsed,at:new Date().toISOString()});
     record(id,'DATA-ACCEPT',{rawHash:parsed.rawHash});
     await writeFile(join(root,'accepted-message.eml'),raw,{mode:0o600,flag:'wx'});
     await persist();if(receiptDelayMs>0)await new Promise(r=>setTimeout(r,receiptDelayMs));send('250 Accepted for fixture delivery');await persist();
    }catch{state.counts.rejectedMessages++;record(id,'DATA-REJECT',{reason:'scope-or-content'});send('550 Fixed TL scope rejected');await persist();}
    return;
   }
   const command=line.split(' ',1)[0].toUpperCase();
   if(command==='EHLO'||command==='HELO'){record(id,command);socket.write('250-T18 isolated fixture\r\n250 AUTH PLAIN\r\n');}
   else if(command==='AUTH'){
    let good=false;if(line.startsWith('AUTH PLAIN ')){const f=Buffer.from(line.slice(11),'base64').toString('utf8').split('\0');good=f.length===3&&f[1]===TL_MAIL.from&&f[2]===secret;}
    state.counts[good?'authAccepted':'authRejected']++;authenticated=good;record(id,'AUTH',{accepted:good});send(good?'235 Authenticated':'535 Rejected');
   }
   else if(command==='MAIL'){from=null;to=[];const m=/^MAIL FROM:<([^<>]+)>$/i.exec(line),good=authenticated&&m?.[1]===TL_MAIL.from;state.counts[good?'mailAccepted':'mailRejected']++;if(good)from=m[1];record(id,'MAIL',{accepted:good});send(good?'250 OK':'553 Rejected');}
   else if(command==='RCPT'){const m=/^RCPT TO:<([^<>]+)>$/i.exec(line),good=authenticated&&from===TL_MAIL.from&&to.length<maxRecipients&&ADDRESS.test(m?.[1]??'');state.counts[good?'rcptAccepted':'rcptRejected']++;if(good)to.push(m[1]);record(id,'RCPT',{accepted:good});send(good?'250 OK':'550 Rejected');}
   else if(command==='DATA'){
    state.counts.dataCommands++;const consumed=onceBudgetPath&&existsSync(onceBudgetPath);
    if(state.counts.acceptedMessages>0||consumed)state.counts.extraDataAttempts++;
    let good=armed&&authenticated&&from===TL_MAIL.from&&to.length>=1&&state.counts.acceptedMessages===0&&!consumed;
    if(good){try{await writeFile(onceBudgetPath,JSON.stringify({schema:1,scope:'TL_20261029',stage:'DATA_PERMITTED',variant:'t18',root,socket:id,at:new Date().toISOString()},null,2),{mode:0o600,flag:'wx'});}catch(error){good=false;if(error.code!=='EEXIST')throw error;}}
    record(id,'DATA',{permitted:good});
    if(good){inData=true;bytes=0;lines=[];send('354 End with dot');}else{state.counts.rejectedMessages++;send('554 Not authorized or fixed scope already consumed');}
   }
   else if(command==='RSET'){from=null;to=[];record(id,'RSET');send('250 Reset');}
   else if(command==='NOOP'){record(id,'NOOP');send('250 OK');}
   else if(command==='QUIT'){record(id,'QUIT');socket.end('221 Bye\r\n');}
   else{record(id,'UNSUPPORTED');send('500 Unsupported command');}
   await persist();
  };
  socket.on('data',chunk=>{buffer+=chunk.toString('utf8');if(buffer.length>2100000){socket.destroy();return;}while(buffer.includes('\r\n')){const i=buffer.indexOf('\r\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+2);chain=chain.then(()=>handle(line)).catch(()=>socket.destroy());}});
 });
 server.maxConnections=4;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const address=server.address();assert(address&&typeof address!=='string'&&address.address==='127.0.0.1');state.port=address.port;await persist();
 return{config:Object.freeze({kind:'smtp',host:'127.0.0.1',port:address.port,username:TL_MAIL.from,fromAddress:TL_MAIL.from,authMode:'password',mode:'plain'}),getPrivateSecret:()=>secret,state:()=>structuredClone(state),assertPublic:text=>assert(!text.includes(secret),'Private synthetic SMTP secret in public evidence'),close:async()=>{if(closed)return;closed=true;for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));await chain;state.closedAt=new Date().toISOString();await persist();}};
}
