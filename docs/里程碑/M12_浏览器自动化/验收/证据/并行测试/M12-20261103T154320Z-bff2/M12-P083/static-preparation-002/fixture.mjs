import{createServer}from'node:http';import{randomBytes,createHash}from'node:crypto';
const sha=x=>createHash('sha256').update(x).digest('hex');
export const fixtureHtml=(role,account)=>'<!doctype html><html><head><meta charset="utf-8"><title>T079 '+role+' account</title></head><body><h1 id="account">Signed in: '+(account??'anonymous')+'</h1><form><label for="name">Account</label><input id="name" aria-label="Account" autocomplete="off"><button type="submit">Login</button></form><p id="result"></p><script>document.querySelector("form").addEventListener("submit",async event=>{event.preventDefault();try{const response=await fetch("/login?role='+role+'",{method:"POST",body:new URLSearchParams({account:document.querySelector("#name").value})});if(!response.ok)throw Error("HTTP "+response.status);const value=await response.json();localStorage.setItem("t079-account",value.account);document.querySelector("#account").textContent="Signed in: "+value.account;document.querySelector("#result").textContent="Login response received"}catch(error){document.querySelector("#result").textContent=String(error)}})</script></body></html>';
export const accountHtml=(role,account)=>fixtureHtml(role,account).replace('</body>','<button id="profile-delete-popup" type="button">Open task profile popup</button><script>document.querySelector("#profile-delete-popup").addEventListener("click",event=>{window.t079PopupClick={trusted:event.isTrusted,count:(window.t079PopupClick?.count??0)+1};window.open("/profile-popup?role='+role+'","T013ProfileDeletionPopup","width=320,height=200,left=20,top=90")})</script></body>');
export function createFixture(){
 const sessions=new Map(),requests=[],sockets=new Set();
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://fixture.invalid'),role=url.searchParams.get('role'),cookie=String(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith('m12_session='))?.slice('m12_session='.length),account=sessions.get(cookie)??null;
  const row={at:new Date().toISOString(),method:req.method,path:url.pathname,role,account,cookieDigest:cookie?sha(cookie):null};requests.push(row);
  if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return}
  if(!['t1','t2','t3','t4','t5','probe'].includes(role)){res.writeHead(400);res.end('Wrong own fixture role');return}
  if(req.method==='POST'&&url.pathname==='/login'){
   let body='';req.on('data',bytes=>{body+=bytes;if(body.length>4096)req.destroy()});req.on('end',()=>{
    const requested=new URLSearchParams(body).get('account');row.requestedAccount=requested;
    if(!['qa','qa2','qa3','qa4','qa5'].includes(requested)){res.writeHead(400);res.end('Only synthetic qa/qa2');return}
    const token=randomBytes(24).toString('hex');sessions.set(token,requested);row.issuedAccount=requested;row.issuedCookieDigest=sha(token);
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','set-cookie':'m12_session='+token+'; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax'});res.end(JSON.stringify({account:requested}));
   });return;
  }
  if(req.method==='GET'&&url.pathname==='/profile-popup'){
   res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
   res.end('<!doctype html><html><head><meta charset="utf-8"><title>T013 task profile named popup</title></head><body><h1 id="popup-account">Popup signed in: '+(account??'anonymous')+'</h1><p>This actual named window remains open until its task profile is deleted.</p></body></html>');return;
  }
  if(req.method!=='GET'||url.pathname!=='/account'){res.writeHead(404);res.end();return}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});
  res.end(accountHtml(role,account));
 });
 server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s))});
 return{server,requests,close:async()=>{for(const s of sockets)s.destroy();server.closeAllConnections();await new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve()))}};
}
