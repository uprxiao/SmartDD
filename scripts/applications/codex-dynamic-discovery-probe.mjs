// T55 native CLI layer only: install an inert, locally authored user plugin
// while a selected session stays alive. No packaged App/UI or real model claim.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parse as parseToml} from 'smol-toml';
import {Client} from '../../docs/里程碑/M10_三方应用接入/技研/实验/runtime-preflight-20261019/codex/probe.mjs';

const cli=process.env.WILLYOU_CODEX_CLI;assert(cli?.startsWith('/private/tmp/willyou-m10-codex-pin-'));
const root=await mkdtemp('/private/tmp/willyou-m10-dynamic-plugin-');
const home=join(root,"home 中文 'quoted"),state=join(root,'native state "quoted"'),cwd=join(root,'project 中文');
const market=join(root,'local-market'),plugin=join(market,'plugins/late-user'),marketFile=join(market,'.agents/plugins/marketplace.json');
const sha=b=>createHash('sha256').update(b).digest('hex');
const env={PATH:dirname(cli)+':'+dirname(process.execPath)+':/usr/bin:/bin',HOME:home,CODEX_HOME:state,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'127.0.0.1,localhost'};
assert.equal(execFileSync(cli,['--version'],{env,encoding:'utf8'}).trim(),'codex-cli 0.162.1');
// Both the npm entry and the fixed native binary are valid isolated launch entries.
const native=cli.endsWith('/vendor/aarch64-apple-darwin/bin/codex')?cli:resolve(dirname(cli),'../@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex');
const result={root,startedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),cli:{path:cli,version:'0.162.1',entrySha256:sha(await readFile(cli)),nativeSha256:sha(await readFile(native))},driverSha256:sha(await readFile(new URL(import.meta.url))),platform:process.platform,arch:process.arch,layer:'Actual pinned CLI, explicit native app-server protocol, synthetic Responses and inert local user plugin; no App/UI, global native roots, credentials, network model or business actions',requests:[],checks:[],launches:[],status:'running'};
for(const p of [home,state,join(cwd,'.git'),dirname(marketFile),join(plugin,'.codex-plugin'),join(plugin,'skills/late-skill')])await mkdir(p,{recursive:true});
const paths={},bodies={},markers={v1:'M10_SELECTED_V1_BODY',v2:'M10_DISABLED_V2_BODY',user:'M10_PREEXISTING_USER_BODY',plugin:'M10_LATE_PLUGIN_BODY'};
for(const id of ['v1','v2','user']){
 paths[id]=join(home,'.agents/skills',id==='user'?'user-preserved':'read-'+id,'SKILL.md');await mkdir(dirname(paths[id]),{recursive:true});
 bodies[id]='---\nname: '+(id==='user'?'user-preserved':'read-'+id)+'\ndescription: Inert '+id+' fixture.\n---\n\n'+markers[id]+'\nNo tools, credentials or external actions are requested.\n';await writeFile(paths[id],bodies[id]);
}
bodies.plugin='---\nname: late-skill\ndescription: Inert local user plugin loaded after native start.\n---\n\n'+markers.plugin+'\nNo executable code or external action.\n';
const pluginSource=join(plugin,'skills/late-skill/SKILL.md');await writeFile(pluginSource,bodies.plugin);
await writeFile(join(plugin,'.codex-plugin/plugin.json'),JSON.stringify({name:'late-user',version:'1.0.0',skills:'./skills'}));
await writeFile(marketFile,JSON.stringify({name:'m10-private-local',plugins:[{name:'late-user',source:'./plugins/late-user'}]}));
const mcpFixture=resolve('scripts/applications/fixtures/codex-marker-mcp.mjs'),mcpManifest=join(root,'user MCP marker.json');
await writeFile(mcpManifest,JSON.stringify({version:'1.0.0',marker:'M10_ORIGINAL_USER_MCP',skillSha256:sha(bodies.user)}));
const sockets=new Set(),pendingWrites=[];let client,stage='bootstrap';const clients=[];
const check=(name,details={})=>{result.checks.push({name,at:new Date().toISOString(),...details});console.log(JSON.stringify({stage,name,checks:result.checks.length}));};
const server=createServer((req,res)=>{let chunks=[],bytes=0;req.on('data',b=>{bytes+=b.length;if(bytes>4*1024*1024)req.destroy();else chunks.push(b);});req.on('end',()=>{
 if(!req.url?.endsWith('/responses')){res.writeHead(404);res.end();return;}
 const raw=Buffer.concat(chunks).toString();let body;try{body=JSON.parse(raw);}catch{res.writeHead(400);res.end();return;}
 const n=result.requests.length+1;pendingWrites.push(writeFile(join(root,'request-'+n+'.json'),raw+'\n'));
 result.requests.push({number:n,at:new Date().toISOString(),sha256:sha(raw),...Object.fromEntries(Object.entries(markers).map(([id,text])=>[id+'Body',raw.includes(text)]))});
 const text='M10_SYNTHETIC_DYNAMIC_'+n,id='msg_'+n,item={id,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
 res.writeHead(200,{'content-type':'text/event-stream','connection':'close'});const send=(type,value)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...value})+'\n\n');
 send('response.created',{response:{id:'resp_'+n,status:'in_progress',output:[]}});send('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}});send('response.content_part.added',{item_id:id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});send('response.output_text.delta',{item_id:id,output_index:0,content_index:0,delta:text});send('response.output_text.done',{item_id:id,output_index:0,content_index:0,text});send('response.content_part.done',{item_id:id,output_index:0,content_index:0,part:item.content[0]});send('response.output_item.done',{output_index:0,item});send('response.completed',{response:{id:'resp_'+n,status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
 });});server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));s.on('error',()=>{});});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const config='model="m10-synthetic"\nmodel_provider="m10"\n[model_providers.m10]\nname="M10 Private Fixture"\nbase_url="http://127.0.0.1:'+server.address().port+'/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[mcp_servers.user_preserved]\ncommand='+JSON.stringify(process.execPath)+'\nargs='+JSON.stringify([mcpFixture,mcpManifest])+'\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n';
await writeFile(join(state,'config.toml'),config);await writeFile(join(root,'config-before-install.toml'),config);
const args=['--disable','apps','--disable','remote_plugin','--disable','multi_agent','--disable','shell_snapshot','--disable','hooks','-c','web_search="disabled"','-c',`skills.config=[{path=${JSON.stringify(paths.v1)},enabled=true},{path=${JSON.stringify(paths.v2)},enabled=false}]`,'app-server','--stdio'];
async function launch(label){const c=new Client(label,args,cwd,env);clients.push(c);result.launches.push({label,pid:c.child.pid,args,cwd,home,state});await c.rpc('initialize',{clientInfo:{name:'m10_dynamic_plugin',version:'1.0.0'},capabilities:{experimentalApi:true}});c.child.stdin.write(JSON.stringify({method:'initialized'})+'\n');return c;}
async function list(c){const response=await c.rpc('skills/list',{cwds:[cwd],forceReload:true});const all=response.data.flatMap(x=>x.skills);return{all,total:all.length,relevant:all.filter(s=>[paths.v1,paths.v2,paths.user,paths.plugin].includes(s.path)).map(({name,path,enabled,pluginId})=>({name,path,enabled,pluginId}))};}
function selected(listed,withPlugin){for(const [id,enabled]of[['v1',true],['v2',false],['user',true]]){const rows=listed.all.filter(s=>s.path===paths[id]);assert.equal(rows.length,1);assert.equal(rows[0].enabled,enabled);}
 if(withPlugin){const rows=listed.all.filter(s=>s.path===paths.plugin);assert.equal(rows.length,1);assert.equal(rows[0].enabled,true);assert.equal(rows[0].pluginId,'late-user@m10-private-local');}}
async function turn(c,threadId,id){let done,timer;const completed=new Promise(r=>done=r),before=result.requests.length,errors=[];c.onMessage=x=>{if(x.method==='turn/completed')done(x.params.turn);if(x.method==='error')errors.push(x.params);};
 try{await c.rpc('turn/start',{threadId,input:[{type:'text',text:'Use the explicitly attached inert skill. Return a short fixture response. No tools or external actions.'},{type:'skill',name:id==='plugin'?'late-user:late-skill':id==='user'?'user-preserved':'read-'+id,path:paths[id]}]});const final=await Promise.race([completed,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Bounded native turn timeout')),15000))]);assert.equal(final.status,'completed',JSON.stringify(errors));const fresh=result.requests.slice(before);assert(fresh.length>0);assert(fresh.some(r=>r[id+'Body']));assert(fresh.every(r=>!r.v2Body));return{threadId,inputSkillPath:paths[id],requests:fresh};}finally{clearTimeout(timer);}}
async function tool(c,threadId){const reply=await c.rpc('mcpServer/tool/call',{threadId,server:'user_preserved',tool:'fixed_marker',arguments:{}});const value=JSON.parse(reply.content.find(x=>x.type==='text').text);assert.equal(value.marker,'M10_ORIGINAL_USER_MCP');assert.equal(value.skillSha256,sha(bodies.user));assert.equal(value.packageHash,sha(await readFile(mcpManifest)));return value;}
async function sourcesUnchanged(){for(const id of ['v1','v2','user'])assert.equal(await readFile(paths[id],'utf8'),bodies[id]);assert.equal(await readFile(pluginSource,'utf8'),bodies.plugin);if(paths.plugin)assert.equal(await readFile(paths.plugin,'utf8'),bodies.plugin);}
async function sessionFiles(path){const out=[];for(const e of await readdir(path,{withFileTypes:true})){const p=join(path,e.name);if(e.isDirectory())out.push(...await sessionFiles(p));else if(e.isFile()&&e.name.endsWith('.jsonl'))out.push(p);}return out;}
try{
 stage='selected-before-plugin';client=await launch('initial');const initial=await list(client);selected(initial,false);assert(!initial.all.some(s=>s.pluginId==='late-user@m10-private-local'));result.beforeDiscovery=initial;
 const started=await client.rpc('thread/start',{cwd,ephemeral:false,sandbox:'read-only',approvalPolicy:'never'});result.threadId=started.thread.id;
 check('Initial exact v1/v2 selection and existing user skill, not a tool-count inference',{discovery:initial.relevant,total:initial.total});
 check('Actual native selected body reaches synthetic provider; disabled body absent',await turn(client,result.threadId,'v1'));
 check('Preexisting user-configured MCP actually returns original marker before plugin addition',{value:await tool(client,result.threadId)});
 stage='async-plugin-install';const livePid=client.child.pid;result.installStartedAt=new Date().toISOString();const installing=client.rpc('plugin/install',{marketplacePath:marketFile,pluginName:'late-user'});let installed;const end=Date.now()+10000;
 do{const snapshot=await list(client),row=snapshot.all.find(s=>s.pluginId==='late-user@m10-private-local'&&s.name==='late-user:late-skill');if(row){paths.plugin=row.path;installed=snapshot;break;}await new Promise(r=>setTimeout(r,100));}while(Date.now()<end);
 result.installReceipt=await installing;assert(installed,'Local plugin did not become discoverable within bounded native window');assert.deepEqual(result.installReceipt.appsNeedingAuth,[]);selected(installed,true);assert.equal(client.child.pid,livePid);assert.equal(client.child.exitCode,null);assert(installed.total>initial.total);await sourcesUnchanged();result.afterDiscovery=installed;
 const afterConfig=await readFile(join(state,'config.toml'),'utf8'),after=parseToml(afterConfig),before=parseToml(config);for(const key of Object.keys(before))assert.deepEqual(after[key],before[key]);assert.equal(after.plugins['late-user@m10-private-local'].enabled,true);await writeFile(join(root,'config-after-install.toml'),afterConfig);result.configMutation={actor:'Actual CLI plugin/install',beforeSha256:sha(config),afterSha256:sha(afterConfig),oldDefinitionsPreserved:true};
 check('Async native user-plugin addition increases discovery but exact original paths remain selected, with same live PID/thread',{pid:livePid,totalBefore:initial.total,totalAfter:installed.total,discovery:installed.relevant,pluginSourceSha256:sha(bodies.plugin)});
 check('Newly discovered user plugin body reaches provider without any disabled-v2 body',await turn(client,result.threadId,'plugin'));
 check('Original selected Skill still works after plugin addition',await turn(client,result.threadId,'v1'));
 check('Original user MCP remains callable after dynamic addition',{value:await tool(client,result.threadId)});
 stage='same-native-resume';await client.close();client=await launch('resume');const resumed=await client.rpc('thread/resume',{threadId:result.threadId,cwd,sandbox:'read-only',approvalPolicy:'never'});assert.equal(resumed.thread.id,result.threadId);const discovery=await list(client);selected(discovery,true);result.resumedDiscovery=discovery;
 check('Same native ID resume retains exact original choices and user plugin, without root replacement',{threadId:resumed.thread.id,discovery:discovery.relevant});
 check('Resumed original selection supplies its body with disabled version excluded',await turn(client,result.threadId,'v1'));
 check('Resumed user plugin supplies its own exact body',await turn(client,result.threadId,'plugin'));
 check('Resumed original user MCP returns the original manifest marker/hash',{value:await tool(client,result.threadId)});
 await sourcesUnchanged();assert.equal(await readFile(join(state,'config.toml'),'utf8'),afterConfig);result.nativeSessionFiles=await sessionFiles(join(state,'sessions'));assert(result.nativeSessionFiles.length>0);
 check('All fixture sources and post-install native user configuration stay byte-identical through reads/resume');result.paths=paths;result.skillSha256=Object.fromEntries(Object.entries(bodies).map(([k,b])=>[k,sha(b)]));result.status='passed-native-layer';
}catch(error){result.status='failed';result.stage=stage;result.error=String(error);result.stack=error.stack;process.exitCode=1;}
finally{
 for(const c of clients){await c.close();await writeFile(join(root,c.label+'-stderr.txt'),c.stderr);(result.clientCleanup??=[]).push({pid:c.child.pid,label:c.label,exitCode:c.child.exitCode,signalCode:c.child.signalCode,unexpectedRequests:c.unexpectedRequests,notifications:c.notifications});}
 for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));await Promise.all(pendingWrites);result.allChildrenExited=clients.every(c=>c.child.exitCode!==null||c.child.signalCode!==null);result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,status:result.status,checks:result.checks.length,stage,error:result.error}));
}
