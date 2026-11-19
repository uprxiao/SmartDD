import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomBytes,createHash } from 'node:crypto';

export async function startSink() {
  const from='a41-sender@example.invalid';
  const destinations=['a41-target@example.invalid','a41-revised@example.invalid'];
  const secret=randomBytes(24).toString('hex');
  const sockets=new Set();
  const results=[];
  let permit=null;
  const counters={ responses:0,unexpected:0 };
  const server=createServer(socket=>{
    assert.equal(socket.remoteAddress,'127.0.0.1');
    sockets.add(socket);
    socket.once('close',()=>sockets.delete(socket));
    socket.on('error',()=>{});
    socket.setTimeout(12000,()=>socket.destroy());
    let buffer='', authed=false, sender=false, target=null, lines=null;
    const send=s=>socket.write(s+'\r\n');
    const reject=()=>{counters.unexpected++;send('550 Synthetic recipient or test timing refused');};
    const handle=line=>{
      if (lines) {
        if (line!=='.') { lines.push(line.replace(/^\.\./,'.')); return; }
        const raw=lines.join('\r\n')+'\r\n';
        const envelope=permit;
        lines=null;
        if (!envelope || target!==envelope.to || !raw.includes('Subject: '+envelope.subject+'\r\n') || !raw.includes(envelope.text)) return reject();
        results.push({ ...envelope, sha256:createHash('sha256').update(raw).digest('hex'), bytes:Buffer.byteLength(raw) });
        permit=null; counters.responses++;
        send('250 Accepted by isolated test receiver');
      } else if (/^(EHLO|HELO) /i.test(line)) send('250-A41 private receiver\r\n250 AUTH PLAIN');
      else if (line.startsWith('AUTH PLAIN ')) {
        const fields=Buffer.from(line.slice(11),'base64').toString().split('\0');
        authed=fields.length===3&&fields[1]===from&&fields[2]===secret;
        send(authed?'235 Authenticated fixture':'535 Rejected synthetic auth');
      } else if (line==='MAIL FROM:<'+from+'>'&&authed) { sender=true; target=null; send('250 Fixture sender'); }
      else if (line.startsWith('RCPT TO:<')&&sender) {
        const to=line.slice(9,-1);
        if (target||!destinations.includes(to)||!line.endsWith('>')) return reject();
        target=to; send('250 Fixture recipient');
      } else if (line==='DATA') {
        if (!permit || !target || !sender || !authed || target!==permit.to) return reject();
        lines=[]; send('354 Synthetic data only');
      } else if (line==='RSET') { sender=false;target=null;send('250 Reset'); }
      else if (line==='NOOP') send('250 OK');
      else if (line==='QUIT') socket.end('221 Bye\r\n');
      else reject();
    };
    socket.on('data',chunk=>{
      buffer+=chunk.toString();
      if(buffer.length>131072||lines?.length>3000){socket.destroy();return;}
      while(buffer.includes('\r\n')&&!socket.destroyed) {
        const end=buffer.indexOf('\r\n');
        const line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        handle(line);
      }
    });
    send('220 Isolated WillYou A41 fixture');
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {
    from,destinations,secret,results,
    config:{kind:'smtp',host:'127.0.0.1',port:server.address().port,username:from,fromAddress:from,authMode:'password',mode:'plain'},
    arm(value){ assert(!permit&&destinations.includes(value.to)&&/^A41_/.test(value.subject)&&/^A41_/.test(value.text));permit={...value}; },
    observe(){return { ...counters, results:[...results] };},
    async stop(){ for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve)); },
  };
}
