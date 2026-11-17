import {spawn,execFileSync} from 'node:child_process';import {createServer} from 'node:net';import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
const root=mkdtempSync('/private/tmp/m14-cli-permissions-'),cwd=root+'/work',home=root+'/home',endpoint='/private/tmp/wy-cli-'+randomUUID()+'.sock';mkdirSync(cwd);mkdirSync(home);const server=createServer(s=>{s.end('OK');});await new Promise(r=>server.listen(endpoint,r));
const deniedEndpoint=endpoint+'.other';const deniedServer=createServer(s=>s.end('BAD'));await new Promise(r=>deniedServer.listen(deniedEndpoint,r));const tcp=createServer(s=>s.end('BAD'));await new Promise(r=>tcp.listen(0,'127.0.0.1',r));const port=tcp.address().port;
const p=spawn('codex',['-c','features.network_proxy=true','-c','permissions.wy_cli_probe.network.enabled=true','-c','default_permissions="wy_cli_probe"','-c','permissions.wy_cli_probe.extends=":workspace"','-c',`permissions.wy_cli_probe.network.unix_sockets={${JSON.stringify(endpoint)}="allow"}`,'app-server'],{cwd,env:{...process.env,HOME:home,CODEX_HOME:home},stdio:['pipe','pipe','pipe']});const waiting=new Map();let text='',stderr='',id=0;p.stderr.on('data',b=>stderr+=b.toString());p.stdout.on('data',b=>{text+=b;let at;while((at=text.indexOf('\n'))>=0){const line=text.slice(0,at);text=text.slice(at+1);try{const m=JSON.parse(line);const w=waiting.get(m.id);if(w){waiting.delete(m.id);clearTimeout(w.timer);m.error?w.reject(Error(JSON.stringify(m.error))):w.resolve(m.result);}}catch{}}});
function call(method,params){const n=++id;return new Promise((resolve,reject)=>{waiting.set(n,{resolve,reject,timer:setTimeout(()=>reject(Error('timeout '+method)),15000)});p.stdin.write(JSON.stringify({id:n,method,params})+'\n');});}
const result={root,assertions:[]};try{await call('initialize',{clientInfo:{name:'m14-cli-probe',version:'1'},capabilities:{experimentalApi:true}});p.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 for(const explicit of [true]){const code=`import socket,json,pathlib
r={}
for name,address,family in [('allowed',${JSON.stringify(endpoint)},socket.AF_UNIX),('other_unix',${JSON.stringify(deniedEndpoint)},socket.AF_UNIX),('tcp',('127.0.0.1',${port}),socket.AF_INET)]:
 try:
  s=socket.socket(family);s.settimeout(1);s.connect(address);r[name]=s.recv(10).decode();s.close()
 except Exception as e:r[name]=type(e).__name__
for name,path in [('inside',${JSON.stringify(cwd+'/yes')}),('outside',${JSON.stringify(root+'/no')})]:
 try:pathlib.Path(path).write_text('owned fixture');r[name]='wrote'
 except Exception as e:r[name]=type(e).__name__
print(json.dumps(r))`;
const params={command:['/usr/bin/python3','-c',code],cwd,timeoutMs:8000,sandboxPolicy:{type:'workspaceWrite',writableRoots:[],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true}};try{result[explicit?'explicit':'inherited']=await call('command/exec',params);}catch(e){result[explicit?'explicit':'inherited']={error:String(e)};}}
}catch(e){result.error=String(e);}finally{p.stdin.end();await new Promise(r=>{p.once('exit',r);setTimeout(()=>{p.kill('SIGTERM');r();},3000).unref();});server.close();deniedServer.close();tcp.close();writeFileSync('/private/tmp/m14-codex-cli-sandbox-negatives.json',JSON.stringify({...result,stderr:stderr.slice(-1000)},null,2));}
