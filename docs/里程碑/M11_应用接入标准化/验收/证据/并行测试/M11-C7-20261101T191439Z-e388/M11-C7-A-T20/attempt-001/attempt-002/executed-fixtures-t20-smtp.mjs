// Private non-relaying SMTP: exact per-intent MIME budget, explicit 250/drop modes.
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {createHash,randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import PostalMime from 'postal-mime';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function startT20Smtp(root){
 assert(root.startsWith('/private/tmp/willyou-m11-t20-'));
 const secret=randomBytes(32).toString('base64url'),sockets=new Set();let serial=0,armed=null,chain=Promise.resolve();
 const state={events:[],connections:[],messages:[],errors:[],verificationReplies:[],dataCommands:0};
 const event=(c,type,extra={})=>state.events.push({socketId:c.id,phase:c.phase,type,at:new Date().toISOString(),monotonicNs:process.hrtime.bigint().toString(),...extra});
 const server=createServer(socket=>{
  const c={id:++serial,phase:'greeting',auth:false,from:null,to:[],data:false,lines:[],bytes:0};state.connections.push(c);sockets.add(socket);
  const send=text=>{if(!socket.destroyed)socket.write(text+'\r\n');};
  event(c,'connected');socket.setTimeout(10000,()=>{event(c,'timeout');socket.destroy();});
  socket.on('error',e=>{const x={socketId:c.id,phase:c.phase,code:e.code??e.name,at:new Date().toISOString()};state.errors.push(x);event(c,'error',x);});
  socket.on('close',hadError=>{event(c,'closed',{hadError});sockets.delete(socket);});send('220 T20 localhost synthetic SMTP');let buffer='';
  const line=async value=>{
   if(socket.destroyed)return;
   if(c.data){
    if(value!=='.'){const v=value.startsWith('..')?value.slice(1):value;c.bytes+=Buffer.byteLength(v)+2;assert(c.bytes<=131072,'Bounded DATA');c.lines.push(v);return;}
    c.data=false;c.phase='data-complete';const raw=Buffer.from(c.lines.join('\r\n')+'\r\n'),expected=c.expected,parsed=await PostalMime.parse(raw);
    assert.equal(sha(raw),expected.rawHash,'Exact production-frozen MIME hash');assert.equal(parsed.from.address,'fixture@example.test');assert.deepEqual(parsed.to.map(x=>x.address),['recipient@example.test']);assert.equal(parsed.subject,expected.subject);assert.equal(parsed.text.replace(/\r?\n$/,''),expected.text);assert.equal(parsed.messageId,expected.messageId);assert.equal(parsed.attachments.length,0);
    const record={intentId:expected.intentId,mode:expected.mode,rawHash:sha(raw),bytes:raw.length,messageId:parsed.messageId,at:new Date().toISOString(),socketId:c.id};state.messages.push(record);await writeFile(join(root,'smtp-'+expected.intentId+'.eml'),raw,{flag:'wx'});event(c,'data-recorded',record);
    if(expected.mode==='drop-250'){event(c,'fault-injection',{action:'Close only this synthetic socket after complete DATA bytes, before any final250'});socket.destroy();}
    else {event(c,'final250-sent',{intentId:expected.intentId});send('250 2.0.0 T20 accepted');}
    return;
   }
   const cmd=value.split(' ')[0].toUpperCase();c.phase=cmd.toLowerCase();event(c,'command',{command:['EHLO','HELO','AUTH','MAIL','RCPT','DATA','QUIT','RSET','NOOP'].includes(cmd)?cmd:'redacted-other'});
   if(cmd==='EHLO'||cmd==='HELO')socket.write('250-T20 localhost\r\n250 AUTH PLAIN\r\n');
   else if(cmd==='AUTH'){const parts=Buffer.from(value.slice('AUTH PLAIN '.length),'base64').toString().split('\0');c.auth=parts.length===3&&parts[1]==='fixture@example.test'&&parts[2]===secret;send(c.auth?'235 2.7.0 verified':'535 rejected');}
   else if(cmd==='MAIL'){assert(c.auth);const m=/^MAIL FROM:<([^<>]+)>$/i.exec(value);assert.equal(m?.[1],'fixture@example.test');c.from=m[1];c.to=[];send('250 sender accepted');}
   else if(cmd==='RCPT'){const m=/^RCPT TO:<([^<>]+)>$/i.exec(value);assert.equal(m?.[1],'recipient@example.test');assert.equal(c.to.length,0);c.to.push(m[1]);send('250 recipient accepted');}
   else if(cmd==='DATA'){
    state.dataCommands++;assert(armed&&c.auth&&c.from==='fixture@example.test'&&c.to.length===1,'No DATA without an exact page-authorized budget');assert(state.dataCommands<=2,'At most normal1 and unknown1 DATA');
    const expected=armed;armed=null;await writeFile(join(root,'smtp-budget-'+expected.intentId+'.json'),JSON.stringify({...expected,consumedAt:new Date().toISOString(),socketId:c.id},null,2),{flag:'wx'});
    c.expected=expected;c.data=true;c.bytes=0;c.lines=[];event(c,'data-permitted',{intentId:expected.intentId,mode:expected.mode});send('354 end with dot');
   }else if(cmd==='QUIT'){event(c,'quit-reply');socket.end('221 bye\r\n');}
   else if(cmd==='RSET'){c.from=null;c.to=[];send('250 reset');}else if(cmd==='NOOP')send('250 ok');else send('500 unsupported');
  };
  socket.on('data',b=>{buffer+=b.toString();if(buffer.length>140000){socket.destroy();return;}while(buffer.includes('\r\n')){const at=buffer.indexOf('\r\n'),v=buffer.slice(0,at);buffer=buffer.slice(at+2);chain=chain.then(()=>line(v)).catch(error=>{state.errors.push({socketId:c.id,phase:c.phase,at:new Date().toISOString(),code:'FIXTURE_SCOPE',message:String(error)});socket.destroy();});}});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {config:{kind:'smtp',host:'127.0.0.1',port:server.address().port,username:'fixture@example.test',fromAddress:'fixture@example.test',authMode:'password',mode:'plain'},secret,state,
  arm(expected){assert(!armed);assert(['accepted','drop-250'].includes(expected.mode));assert(/^[a-f0-9]{64}$/.test(expected.rawHash));assert(!state.messages.some(x=>x.intentId===expected.intentId));armed=structuredClone(expected);},
  verification(reply){state.verificationReplies.push({at:new Date().toISOString(),ok:reply.ok,code:reply.code??null,operationId:reply.value?.operationId??null});},
  async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await chain;return{state,listening:server.listening,sockets:sockets.size,unconsumedBudget:armed};}};
}
