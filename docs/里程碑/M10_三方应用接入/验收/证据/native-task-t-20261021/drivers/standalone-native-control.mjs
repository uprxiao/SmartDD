process.noAsar=true;
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openElectron} from '/private/tmp/m10-legacy-recovery-r-20261021/work-r4/scripts/lib/electron-harness.mjs';
import {installAppFocusGuard,isAppFocusYield} from '/private/tmp/m10-legacy-recovery-r-20261021/work-r4/scripts/lib/app-focus-guard.mjs';

const root=await mkdtemp('/private/tmp/willyou-m10-native-t-');
const home=join(root,'home'),state=join(root,'codex'),cwd=join(root,'project'),userData=join(root,'userdata');
const appRoot='/private/tmp/m10-native-config-s2-package-20261021/mac-arm64/WillYou.app';
const executable=join(appRoot,'Contents/MacOS/WillYou'),cli='/Users/liubu/.local/bin/codex';
const sha=b=>createHash('sha256').update(b).digest('hex');
const marker='M10_UI_NATIVE_TASK_'+root.split('-').at(-1);
const result={schema:'m10-packaged-native-ui-v1',startedAt:new Date().toISOString(),root,userData,home,state,cwd,
 branch:'feature/0.0.2',sourceCommit:'3a23d7524758e1beaf9309335aa8f78ed4e1055c',
 app:appRoot,asarSha256:sha(await readFile(join(appRoot,'Contents/Resources/app.asar'))),
 layer:'Native CLI standalone PTY control; no WillYou GUI or TaskService; private synthetic provider only',
 isolation:{minimalDriverEnv:true,freshHome:true,freshCodexHome:true,freshUserData:true,noDailyCredentialsCopied:true,proxy:'unreachable loopback except localhost',setup:'project, AI profile and application selection via RPC are prerequisites, not UI coverage'},
 marker,requests:[],checks:[],status:'running'};
assert.equal(result.asarSha256,'1a578d44103a65f0dd19e2beb0726cbc32bc2cfa954b5bdef95d6f8e705ca900');
assert.equal(execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),'codex-cli 0.162.1');
for(const p of [home,state,join(cwd,'.git'),join(home,'.agents/skills/m10-owned-config')])await mkdir(p,{recursive:true});
const skill=join(home,'.agents/skills/m10-owned-config/SKILL.md');
await writeFile(skill,'---\nname: m10-owned-config\ndescription: Private configuration preservation marker.\n---\nNo action is required.\n');
let stage='setup',app,task,project,profile;
const sockets=new Set();
const progress=async()=>{const value={at:new Date().toISOString(),stage,root,pid:app?.processId,taskId:task?.id,requests:result.requests.length};await writeFile(join(root,'progress.json'),JSON.stringify(value,null,2)+'\n');console.log(JSON.stringify(value));};
const checked=(name,details={})=>{result.checks.push({name,at:new Date().toISOString(),passed:true,...details});};
const server=createServer((req,res)=>{let chunks=[],bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024)req.destroy();else chunks.push(b);});req.on('end',()=>{
 if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString())}catch{res.writeHead(400);res.end('{}');return;}
 const raw=JSON.stringify(body),taskRequest=raw.includes(marker),healthCode=raw.match(/SMARTDD-OK-[0-9a-f]{8}/)?.[0];
 const text=taskRequest?marker+'_DONE':healthCode??'M10_PRIVATE_FIXTURE_OK';
 const item={at:new Date().toISOString(),kind:taskRequest?'native-control':healthCode?'profile-health':'unclassified',model:body.model,
  requestBytes:bytes,sha256:sha(raw),userSkillMarkerPresent:raw.includes('m10-owned-config'),
  toolNames:(body.tools??[]).map(x=>x.name??x.type),response:text};result.requests.push(item);console.log(JSON.stringify({request:item.kind,model:item.model,tools:item.toolNames}));
 res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'close'});
 const id='msg_m10_'+result.requests.length,message={id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
 const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
 send('response.created',{response:{id:'resp_'+id,object:'response',created_at:Math.floor(Date.now()/1000),status:'in_progress',output:[]}});
 send('response.output_item.added',{output_index:0,item:{...message,status:'in_progress',content:[]}});
 send('response.content_part.added',{item_id:id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
 send('response.output_text.delta',{item_id:id,output_index:0,content_index:0,delta:text});
 send('response.output_text.done',{item_id:id,output_index:0,content_index:0,text});
 send('response.content_part.done',{item_id:id,output_index:0,content_index:0,part:message.content[0]});
 send('response.output_item.done',{output_index:0,item:message});
 send('response.completed',{response:{id:'resp_'+id,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[message],usage:{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}}});res.end();
 });});server.on('connection',s=>{sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;
const config='model="m10-base-model"\nmodel_provider="m10_local_fixture"\nnotify=[]\n[model_providers.m10_local_fixture]\nname="M10 Synthetic Local Fixture"\nbase_url="http://127.0.0.1:'+port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n[projects.'+JSON.stringify(cwd)+']\ntrust_level="trusted"\n';
const profileText='model="m10-ui-profile-model"\nskills.config=[{path='+JSON.stringify(skill)+',enabled=false}]\n';
await writeFile(join(state,'config.toml'),config);await writeFile(join(state,'m10-native.config.toml'),profileText);
const privateEnv={HOME:home,ZDOTDIR:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost',SHELL:'/bin/zsh'};

const {createRequire}=await import('node:module');
const require=createRequire('/private/tmp/m10-legacy-recovery-r-20261021/work-r4/package.json');
const pty=require('node-pty');let child,out='';
try{
 stage='standalone-native-tui';await progress();
 child=pty.spawn(cli,['--profile','m10-native','--disable','hooks','--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','-c','web_search="disabled"','-c','skills.config=[]','--sandbox','read-only','--ask-for-approval','never',marker+': Answer with the completion token returned by the local fixture. Do not call any tools.'],{cwd,env:{PATH:process.env.PATH,...privateEnv,TERM:'xterm-256color',LANG:'en_US.UTF-8'},cols:130,rows:40});
 result.nativePid=child.pid;child.onData(data=>{out+=data;if(data.includes('\x1b[6n'))child.write('\x1b[1;1R');});
 const end=Date.now()+20000;while(Date.now()<end&&!(result.requests.some(r=>r.kind==='native-control')&&out.includes(marker+'_DONE')))await new Promise(r=>setTimeout(r,100));
 assert(result.requests.some(r=>r.kind==='native-control'),'No standalone native provider request');assert(out.includes(marker+'_DONE'),'Standalone native completion not observed');
 const actual=await readFile(join(state,'m10-native.config.toml'),'utf8');result.profileBefore=profileText;result.profileAfter=actual;result.nativeProfileChanged=actual!==profileText;
 assert(result.nativeProfileChanged);assert(actual.startsWith(profileText));assert(actual.includes('screen_reader_detection_done = true'));assert(actual.includes('[tui.model_availability_nux]'));assert.equal(await readFile(join(state,'config.toml'),'utf8'),config);
 checked('Standalone actual Codex TUI appends its own notice metadata to the selected profile without WillYou GUI/TaskService');result.status='passed-with-boundaries';
}catch(error){result.status='failed';result.error=String(error);result.stack=error.stack;process.exitCode=1;}
finally{if(child){const exited=new Promise(r=>child.onExit(r));child.kill();result.nativeCleanup=await Promise.race([exited,new Promise(r=>setTimeout(()=>r({timeout:true}),3000))]);}await writeFile(join(root,'terminal-control.txt'),out);for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile('/private/tmp/m10-packaged-native-t-20261021/native-control-result-path.txt',join(root,'result.json')+'\n');console.log(JSON.stringify({status:result.status,error:result.error,result:join(root,'result.json')}));}
