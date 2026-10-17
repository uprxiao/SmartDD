// Official SDK + real local file + native exchange probe; custom write protocol.
// This is an isolated adapter feasibility test, NOT the third-party viewer host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const sdk='/private/tmp/m9-r34-provider/node_modules/@modelcontextprotocol';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const URI='willyou-test://session/document.txt', TOOL='willyou_write_resource_if_match';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const MAX=20*1024*1024;

if(process.argv[2]==='--server'){
  const root=process.argv[3], file=path.join(root,'document.txt'), generation=1;
  const initial=fs.statSync(root),receipts=new Map();let subscribed=false,watchTimer;
  const {Server}=await import(sdk+'/server/dist/index.mjs');
  const {StdioServerTransport}=await import(sdk+'/server/dist/stdio.mjs');
  const server=new Server({name:'WillYou isolated disk adapter',version:'predev-1'},{capabilities:{resources:{subscribe:true},tools:{}}});
  const snapshot=()=>{const rs=fs.statSync(root);if(rs.dev!==initial.dev||rs.ino!==initial.ino)throw Error('stale-root');const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const st=fs.fstatSync(fd);if(!st.isFile()||st.size>MAX)throw Error('invalid-source');const b=fs.readFileSync(fd);return {bytes:b,etag:sha(b)};}finally{fs.closeSync(fd);}};
  server.setRequestHandler('resources/list',async()=>({resources:[{uri:URI,name:'document.txt',mimeType:'text/plain'}]}));
  server.setRequestHandler('resources/read',async req=>{if(req.params.uri!==URI)throw Error('wrong-resource');const s=snapshot();return{contents:[{uri:URI,mimeType:'text/plain',text:s.bytes.toString('utf8'),_meta:{etag:s.etag,generation}}]};});
  server.setRequestHandler('resources/subscribe',async req=>{if(req.params.uri!==URI)throw Error('wrong-resource');subscribed=true;return{};});
  server.setRequestHandler('resources/unsubscribe',async req=>{if(req.params.uri!==URI)throw Error('wrong-resource');subscribed=false;return{};});
  server.setRequestHandler('tools/list',async()=>({tools:[{name:TOOL,description:'Isolated SmartDD-specific ifMatch contract; NOT an MCP standard write method',inputSchema:{type:'object',properties:{uri:{type:'string'},text:{type:'string'},ifMatch:{type:'string'},opId:{type:'string'},generation:{type:'integer'}},required:['uri','text','ifMatch','opId','generation'],additionalProperties:false}}]}));
  server.setRequestHandler('tools/call',async req=>{
    const a=req.params.arguments||{};let result;
    if(req.params.name!==TOOL||a.uri!==URI)result={state:'rejected',reason:'wrong-resource-or-tool'};
    else if(a.generation!==generation)result={state:'rejected',reason:'stale-generation'};
    else if(typeof a.text!=='string'||typeof a.ifMatch!=='string'||!/^[a-z0-9-]{1,80}$/.test(a.opId||''))result={state:'rejected',reason:'invalid-request'};
    else if(Buffer.byteLength(a.text)>MAX)result={state:'too-large'};
    else{
      const signature=sha(JSON.stringify(a)),previous=receipts.get(a.opId);
      if(previous)result=previous.signature===signature?{...previous.result,replayed:true}:{state:'rejected',reason:'op-id-payload-mismatch'};
      else{
        const s=snapshot();
        if(s.etag!==a.ifMatch)result={state:'conflict',etag:s.etag};
        else{
          // Existing native-exchange experiment provides version retention, not a production OS CAS.
          const py=`import sys,json,pathlib,importlib.util,hashlib\np=pathlib.Path(sys.argv[1]);s=importlib.util.spec_from_file_location('save',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nr=m.journal_save(pathlib.Path(sys.argv[2]),'document.txt',sys.stdin.buffer.read(),sys.argv[3]);print(json.dumps(r))\n`;
          const r=JSON.parse(execFileSync('python3',['-c',py,path.join(here,'save-recovery-probe.py'),root,a.ifMatch],{input:a.text,encoding:'utf8',maxBuffer:1024*1024}));
          result=r.status==='saved'?{state:'saved',etag:snapshot().etag}:{state:'conflict',reason:r.status};
          receipts.set(a.opId,{signature,result});
        }
      }
    }
    return{content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result};
  });
  const watcher=fs.watch(root,()=>{clearTimeout(watchTimer);watchTimer=setTimeout(()=>{if(subscribed)server.sendResourceUpdated({uri:URI}).catch(()=>{});},30);});
  const cleanup=()=>{clearTimeout(watchTimer);watcher.close();};
  process.stdin.on('end',()=>{cleanup();server.close().finally(()=>process.exit(0));});
  process.on('SIGTERM',()=>{cleanup();process.exit(0);});
  await server.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:Math.ceil(MAX*4/3)+256*1024}));
}else{
  const output=process.argv[2];if(!output||fs.existsSync(output))throw Error('Provide NEW report path');
  const {Client}=await import(sdk+'/client/dist/index.mjs');const {StdioClientTransport}=await import(sdk+'/client/dist/stdio.mjs');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'m9-predev-provider-')),file=path.join(root,'document.txt');fs.writeFileSync(file,'BASE 中文 😀\n');
  const report={startedAt:new Date().toISOString(),scope:'official MCP SDK 2.0.0, custom isolated adapter, real synthetic file/native exchange/watch; not production viewer host',cases:[],sources:['https://modelcontextprotocol.io/specification/2025-06-18/server/resources'],limits:['Custom write contract is not standardized MCP and does not make arbitrary viewers writable','Node read boundary is fixed fixture only; production fd-anchored root broker still required','No cross-platform or App acceptance'],notifications:[]};
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(import.meta.url),'--server',root],stderr:'pipe',maxBufferSize:Math.ceil(MAX*4/3)+256*1024});
  let stderr='';transport.stderr.on('data',d=>{stderr+=d;});
  const client=new Client({name:'WillYou predevelopment protocol host',version:'1'});let active=true,accepted=0,ignored=0;
  client.setNotificationHandler('notifications/resources/updated',async n=>{report.notifications.push(n.params.uri);if(active&&n.params.uri===URI)accepted++;else ignored++;});
  const run=async(id,title,fn)=>{try{report.cases.push({id,title,status:'passed',evidence:await fn()});}catch(e){report.cases.push({id,title,status:'failed',error:String(e.stack)});}};
  const read=()=>client.readResource({uri:URI},{cacheMode:'no-store'});
  const write=async arguments_=>(await client.callTool({name:TOOL,arguments:arguments_})).structuredContent;
  const input=(opId,text,etag)=>({opId,text,ifMatch:etag,uri:URI,generation:1});
  try{
    await client.connect(transport);report.server=client.getServerVersion();report.capabilities=client.getServerCapabilities();let base, saved;
    await run('PV01','官方协议握手、声明订阅、严格资源读取与真实文件哈希',async()=>{assert(report.capabilities.resources.subscribe);const a=await read();base=a.contents[0]._meta.etag;assert.equal(base,sha(fs.readFileSync(file)));assert.equal(a.contents[0].text,'BASE 中文 😀\n');return{etag:base};});
    await run('PV02','自定义ifMatch保存真实文件并保留原件和独立草稿',async()=>{saved=await write(input('save-one','EDITED 中文 😀\n',base));assert.equal(saved.state,'saved');assert.equal(fs.readFileSync(file,'utf8'),'EDITED 中文 😀\n');const recovery=fs.readdirSync(path.join(root,'.m9-recovery'));assert(recovery.some(x=>x.endsWith('.draft'))&&recovery.some(x=>x.endsWith('.original')));return{...saved,recoveryObjects:recovery.length};});
    await run('PV03','同opId同载荷返回原回执、不重写文件',async()=>{const before=fs.statSync(file);const r=await write(input('save-one','EDITED 中文 😀\n',base));assert(r.replayed);assert.equal(fs.statSync(file).ino,before.ino);return r;});
    await run('PV04','同opId改载荷拒绝',async()=>{const r=await write(input('save-one','DIFFERENT',base));assert.equal(r.reason,'op-id-payload-mismatch');return r;});
    await run('PV05','旧版本写回冲突，不覆盖外部内容',async()=>{fs.writeFileSync(file,'EXTERNAL');const r=await write(input('stale-write','MY DRAFT',saved.etag));assert.equal(r.state,'conflict');assert.equal(fs.readFileSync(file,'utf8'),'EXTERNAL');return r;});
    await run('PV06','订阅真实磁盘变化，收到通知后重新读取内容',async()=>{await client.subscribeResource({uri:URI});const count=accepted;fs.writeFileSync(file,'EXTERNAL UPDATED');for(let n=0;n<40&&accepted===count;n++)await wait(25);assert(accepted>count);assert.equal((await read()).contents[0].text,'EXTERNAL UPDATED');return{notifications:accepted-count};});
    await run('PV07','解除订阅后不再推送新磁盘变化',async()=>{await client.unsubscribeResource({uri:URI});await wait(80);const count=accepted;fs.writeFileSync(file,'AFTER UNSUBSCRIBE');await wait(120);assert.equal(accepted,count);return{additionalNotifications:0};});
    await run('PV08','读取或写入其他URI被拒绝，当前文件不变',async()=>{let rejected=false;try{await client.readResource({uri:'file:///not-authorized'});}catch{rejected=true;}assert(rejected);const before=sha(fs.readFileSync(file));const r=await write({...input('bad-uri','BAD','x'),uri:'file:///not-authorized'});assert.equal(r.state,'rejected');assert.equal(sha(fs.readFileSync(file)),before);return{readRejected:rejected,write:r};});
    await run('PV09','旧会话代际写回拒绝',async()=>{const r=await write({...input('old-generation','BAD',sha(fs.readFileSync(file))),generation:0});assert.equal(r.reason,'stale-generation');return r;});
    await run('PV10','取消会话后迟到资源通知不更新活动文档',async()=>{await client.subscribeResource({uri:URI});active=false;const count=accepted;fs.writeFileSync(file,'AFTER HOST DISPOSE');for(let i=0;i<40&&!ignored;i++)await wait(25);assert(ignored>0);assert.equal(count,accepted);return{ignored,acceptedUnchanged:true};});
    await run('PV11','错误工具不能成为任意命令入口',async()=>{const r=(await client.callTool({name:'arbitrary_command',arguments:{}})).structuredContent;assert.equal(r.state,'rejected');return r;});
    await client.close();
    await run('PV12','关闭传输后子进程实际退出、watcher释放',async()=>{await wait(100);const pid=transport.pid;let alive=false;if(pid){try{process.kill(pid,0);alive=true;}catch{}}assert(!alive);return{pid:pid??null,alive,transportClosed:true};});
  }finally{await client.close().catch(()=>{});fs.rmSync(root,{recursive:true,force:true});}
  report.stderr=stderr;report.scriptSha256=sha(fs.readFileSync(fileURLToPath(import.meta.url)));report.completedAt=new Date().toISOString();report.summary=Object.fromEntries(['passed','failed'].map(k=>[k,report.cases.filter(x=>x.status===k).length]));fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({summary:report.summary,failures:report.cases.filter(x=>x.status==='failed')}));process.exitCode=report.summary.failed?1:0;
}
