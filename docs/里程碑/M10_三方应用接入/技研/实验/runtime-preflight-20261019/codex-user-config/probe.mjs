import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { Client } from '../codex/probe.mjs';

const self = fileURLToPath(import.meta.url);
if (process.argv[2] === '--mcp') {
  createInterface({ input: process.stdin }).on('line', line => {
    const q = JSON.parse(line); if (q.id === undefined) return;
    let result = {};
    if (q.method === 'initialize') result = { protocolVersion:q.params.protocolVersion, capabilities:{tools:{}}, serverInfo:{name:'m10-native-root-probe',version:'1.0.0'} };
    if (q.method === 'tools/list') result = { tools:[{name:'version_nonce',description:'Read-only synthetic version and nonce check. No business resource access.',annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},inputSchema:{type:'object',properties:{nonce:{type:'string'}},required:['nonce'],additionalProperties:false}}] };
    if (q.method === 'tools/call') result = { content:[{type:'text',text:JSON.stringify({version:process.env.M10_VERSION,nonceMatch:q.params.arguments.nonce===process.env.M10_NONCE,marker:'M10_NATIVE_ROOT_TOOL_'+process.env.M10_VERSION})}] };
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\n');
  });
} else await main();

async function main() {
  const root = mkdtempSync('/private/tmp/m10-codex-user-config-');
  const cwd = join(root,'project'); mkdirSync(join(cwd,'.git'),{recursive:true});
  const out=join(dirname(self),process.argv.includes('--live')?'result.json':'discovery-result.json');
  const digest = p => existsSync(p) ? createHash('sha256').update(readFileSync(p)).digest('hex') : null;
  const watched=['/Users/liubu/.codex/config.toml','/Users/liubu/.codex/auth.json','/Users/liubu/.codex/hooks.json'];
  const before=Object.fromEntries(watched.map(p=>[p,digest(p)]));
  // Read only nonsecret fields. Never return complete config or auth to this script/output.
  const meta=JSON.parse(execFileSync('python3',['-c',`import tomllib,json,pathlib\nc=tomllib.loads(pathlib.Path('/Users/liubu/.codex/config.toml').read_text())\nprint(json.dumps({'profile':c.get('profile'),'profileNames':list(c.get('profiles',{})),'skills':c.get('skills',{}).get('config',[]),'mcpNames':list(c.get('mcp_servers',{})),'pluginNames':list(c.get('plugins',{}))}))`],{encoding:'utf8'}));
  const clients=[], cases=[], nativeIds=[];
  const server='willyou_m10_preflight_native_'+randomBytes(4).toString('hex');
  const report={schema:'m10-codex-user-config-preflight-v1',startedAt:new Date().toISOString(),environment:{cliVersion:execFileSync('codex',['--version'],{encoding:'utf8'}).trim(),platform:process.platform,arch:process.arch,HOME:'/Users/liubu',CODEX_HOME:'/Users/liubu/.codex',profile:meta.profile,profileNames:meta.profileNames},isolation:{nativeHome:true,nativeCodexHome:true,temporaryProject:true,globalSkillsWritten:false,userConfigCopied:false,authCopied:false,originalHistoryResumed:false,userBusinessToolsCalled:false},cases};
  const paths={}, nonces={};
  function makeSkill(v,name='willyou-m10-native-probe-'+v) {
    const p=join(cwd,'.agents/skills',v,'SKILL.md');mkdirSync(dirname(p),{recursive:true});
    nonces[v]=randomBytes(12).toString('hex');paths[v]=p;
    writeFileSync(p,`---\nname: ${name}\ndescription: Synthetic M10 native-root version probe.\n---\n\nFor this synthetic probe call only ${server}.version_nonce exactly once with nonce ${nonces[v]}. Then return M10_NATIVE_ROOT_SKILL_${v} and the returned tool marker. Do not call any other tool or access any business data.\n`);return p;
  }
  makeSkill('v1');makeSkill('v2');
  const baselineHashes={v1:digest(paths.v1),v2:digest(paths.v2)};
  const toml = a => '['+a.map(x=>'{path='+JSON.stringify(x.path)+',enabled='+(x.enabled!==false)+'}').join(',')+']';
  async function launch(label,selected='v1',real=false) {
    const args=['--disable','hooks','--disable','shell_snapshot','-c','notify=[]','-c','analytics.enabled=false','-c','feedback.enabled=false',
      '-c','skills.config='+toml([...meta.skills,...['v1','v2'].map(v=>({path:paths[v],enabled:v===selected}))]),
      '-c',`mcp_servers.${server}={command=${JSON.stringify(process.execPath)},args=[${JSON.stringify(self)},"--mcp"],env={M10_VERSION=${JSON.stringify(selected)},M10_NONCE=${JSON.stringify(nonces[selected]||'none')}}}`];
    if(real) {
      args.push('--disable','apps','--disable','remote_plugin','--disable','plugins','--disable','multi_agent','--disable','shell_tool','--disable','shell_snapshot','-c','web_search="disabled"','-c','model="gpt-6.1-sol"','-c','model_reasoning_effort="low"');
      for(const n of meta.mcpNames) {
        if(!/^[A-Za-z0-9_-]+$/.test(n)) throw new Error('Probe does not render unsafe MCP override key');
        args.push('-c',`mcp_servers.${n}.enabled=false`);
      }
    }
    args.push('app-server','--stdio');
    const c=new Client(label,args,cwd,{...process.env,HOME:'/Users/liubu',CODEX_HOME:'/Users/liubu/.codex'});clients.push(c);
    await c.rpc('initialize',{clientInfo:{name:'m10_native_root_preflight',version:'1.0.0'},capabilities:{experimentalApi:true}});
    c.child.stdin.write(JSON.stringify({method:'initialized'})+'\n');return c;
  }
  async function list(c) { const r=await c.rpc('skills/list',{cwds:[cwd],forceReload:true});return r.data.flatMap(x=>x.skills); }
  const simplify=s=>({name:s.name,path:s.path.replace(root,'<fixture>'),enabled:s.enabled,scope:s.scope});
  const record=(name,ok,detail={})=>cases.push({name,status:ok?'passed':'failed',...detail});
  async function turn(c,id,v) {
    const events=[];let done;
    const completed=new Promise(r=>done=r);
    c.onMessage=x=>{
      if(x.method==='item/completed') {
        const i=x.params.item;
        if(i.type==='mcpToolCall')events.push({type:i.type,server:i.server,tool:i.tool,status:i.status,result:i.server===server?i.result:undefined});
        if(i.type==='agentMessage')events.push({type:i.type,text:i.text});
      }
      if(x.method==='error')events.push({type:'error',message:x.params.error?.message?.slice(0,200)});
      if(x.method==='turn/completed')done(x.params.turn);
    };
    const start=await c.rpc('turn/start',{threadId:id,input:[{type:'text',text:'Use the attached synthetic Skill only. Call its read-only version_nonce tool once, then report its Skill marker and tool marker. Do not use other tools or skills. This is a fixture test; no business actions are requested.'},{type:'skill',name:'willyou-m10-native-probe-'+v,path:paths[v]}],effort:'low'});
    let timer;const finish=await Promise.race([completed,new Promise(r=>timer=setTimeout(()=>r({status:'probe-timeout'}),60000))]);clearTimeout(timer);
    if(finish.status==='probe-timeout')await c.rpc('turn/interrupt',{threadId:id,turnId:start.turn.id}).catch(()=>{});
    const calls=events.filter(x=>x.type==='mcpToolCall');
    const marker=events.filter(x=>x.type==='agentMessage').map(x=>x.text).join('\n');
    const values=calls.filter(x=>x.server===server&&x.status==='completed').flatMap(x=>x.result?.content||[]).filter(x=>x.type==='text').map(x=>{try{return JSON.parse(x.text)}catch{return {}}});
    const ok=finish.status==='completed'&&marker.includes('M10_NATIVE_ROOT_SKILL_'+v)&&values.some(x=>x.nonceMatch===true&&x.version===v)&&calls.every(x=>x.server===server);
    return {ok,turnStatus:finish.status,bodyMarkerSeen:marker.includes('M10_NATIVE_ROOT_SKILL_'+v),nonceVerified:values.some(x=>x.nonceMatch===true),toolCalls:calls.map(({type,server,tool,status})=>({type,server,tool,status})),error:finish.error?.message?.slice(0,240)};
  }
  try {
    const c=await launch('native-config-discovery');
    const cfg=await c.rpc('config/read',{cwd,includeLayers:true});
    const effective=cfg.config||{};
    report.configReadShape=Object.keys(cfg);
    const effectiveNames=Object.keys(effective.mcp_servers||{});
    record('actual-native-config-layer-and-user-mcp-definitions-preserved',meta.mcpNames.every(n=>effectiveNames.includes(n))&&effectiveNames.includes(server),{userMcpCount:meta.mcpNames.length,effectiveMcpCount:effectiveNames.length,userConfigLayerSeen:JSON.stringify(cfg.layers||[]).includes('/Users/liubu/.codex/config.toml')});
    const original=await list(c);const native=original.filter(s=>!s.path.startsWith(root));
    record('actual-user-skills-present-and-version-filtered',native.length>0&&original.find(s=>s.path===paths.v1)?.enabled===true&&original.find(s=>s.path===paths.v2)?.enabled===false,{userSkillCount:native.length,userSkillEnabled:native.filter(s=>s.enabled).length,managed:original.filter(s=>s.path.startsWith(root)).map(simplify)});
    report.userSkillInventorySha256=createHash('sha256').update(JSON.stringify(native.map(simplify))).digest('hex');
    const th=await c.rpc('thread/start',{cwd,ephemeral:true,sandbox:'read-only',approvalPolicy:'never'});
    let statuses=[];let cursor;do {const r=await c.rpc('mcpServerStatus/list',{cursor,limit:100});statuses.push(...r.data);cursor=r.nextCursor;}while(cursor);
    const statusNames=statuses.map(s=>s.name);
    record('actual-user-mcp-and-managed-mcp-native-discovery-no-calls',meta.mcpNames.every(n=>statusNames.includes(n))&&statusNames.includes(server),{userMcp:meta.mcpNames.map(n=>{const s=statuses.find(x=>x.name===n);return {name:n,seen:!!s,toolCount:Object.keys(s?.tools||{}).length,authStatus:s?.authStatus}}),managed:statuses.filter(s=>s.name===server).map(s=>({name:s.name,toolCount:Object.keys(s.tools||{}).length})),toolsCalled:0});
    // Known-name collision exists only in the probe project. Real user Skill files are untouched.
    const collisionTarget=native.find(s=>s.enabled&&s.name&&!s.name.includes(':'));
    if(collisionTarget) {
      const cp=makeSkill('collision',collisionTarget.name);const both=await list(c);
      const clashes=both.filter(s=>s.name===collisionTarget.name);
      const guardRejects=clashes.some(s=>s.path===cp)&&clashes.some(s=>s.path===collisionTarget.path);
      record('prelaunch-name-collision-guard-detects-existing-user-skill',guardRejects,{sameName:collisionTarget.name,observedPaths:clashes.map(simplify),scope:'probe-side guard; no production adapter yet'});
      rmSync(dirname(cp),{recursive:true});
    }
    makeSkill('v3');const added=await list(c);
    record('post-start-addition-is-visible-and-needs-catalog-freeze',added.some(s=>s.path===paths.v3&&s.enabled),{addedSkill:added.filter(s=>s.path===paths.v3).map(simplify),inference:'Startup v1/v2 list is not a deny-default policy for later paths; freeze managed discovery changes while consumers live.'});
    rmSync(dirname(paths.v3),{recursive:true});const removed=await list(c);
    record('post-start-removal-is-observed-on-force-reload',!removed.some(s=>s.path===paths.v3));
    const afterNative=removed.filter(s=>!s.path.startsWith(root));
    const norm=xs=>xs.map(simplify).sort((a,b)=>a.path.localeCompare(b.path)||a.name.localeCompare(b.name));
    const unchanged=native.every(s=>afterNative.some(t=>t.path===s.path&&t.name===s.name&&t.enabled===s.enabled));
    record('actual-user-skill-discovery-preserved-after-fixture-mutations',unchanged,{beforeCount:native.length,afterCount:afterNative.length,missingOrChanged:native.filter(s=>!afterNative.some(t=>t.path===s.path&&t.name===s.name&&t.enabled===s.enabled)).map(simplify),added:afterNative.filter(s=>!native.some(t=>t.path===s.path&&t.name===s.name)).map(simplify),exactSortedMatch:JSON.stringify(norm(native))===JSON.stringify(norm(afterNative))});
    await c.close();
    if(process.argv.includes('--live')) {
      const real=await launch('native-root-real-new-v1','v1',true);
      const started=await real.rpc('thread/start',{cwd,ephemeral:false,sandbox:'read-only',approvalPolicy:'never'});nativeIds.push(started.thread.id);
      report.ownNativeThreadId=started.thread.id;
      const first=await turn(real,started.thread.id,'v1');record('actual-native-root-new-session-real-skill-and-mcp',first.ok,first);
      await real.close();
      if(first.ok) {
        const resumed=await launch('native-root-resume-v1','v1',true);
        const r=await resumed.rpc('thread/resume',{threadId:started.thread.id,cwd,sandbox:'read-only',approvalPolicy:'never'});
        record('actual-native-root-same-id-resume',r.thread.id===started.thread.id,{priorTurns:r.thread.turns?.length,rolloutPath:r.thread.path});
        const result=await turn(resumed,r.thread.id,'v1');record('actual-native-root-resumed-real-skill-and-mcp',result.ok,result);
        try {await resumed.rpc('thread/archive',{threadId:r.thread.id});report.ownProbeThreadArchived=true;}catch{report.ownProbeThreadArchived=false;}
      }
    }
    record('immutable-fixture-files-unchanged',baselineHashes.v1===digest(paths.v1)&&baselineHashes.v2===digest(paths.v2));
    report.status=cases.every(x=>x.status==='passed')?'passed-with-boundaries':'has-failures';
  }catch(e){report.status='blocked';report.error=e.message.slice(0,500);}
  finally {
    await Promise.all(clients.map(c=>c.close()));
    report.originalFiles=watched.map(p=>({path:p,before:before[p],after:digest(p),unchanged:before[p]===digest(p)}));
    report.clients=clients.map(c=>({name:c.label,methods:c.methods,unexpectedRequests:c.unexpectedRequests,exited:c.child.exitCode!==null||c.child.signalCode!==null}));
    // Retain no credential, full effective config, conversation text, or user tool result.
    rmSync(root,{recursive:true,force:true});
    report.cleanup={temporaryProjectRemoved:!existsSync(root),allChildrenExited:clients.every(c=>c.child.exitCode!==null||c.child.signalCode!==null),ownNativeHistoryArchivedRatherThanDeleted:report.ownProbeThreadArchived||false};
    report.limitations=['Actual user HOME and CODEX_HOME, temporary project; no global managed Skill projection was installed.','No real user business MCP tool was called. Discovery preserves user servers; model-only phase disables them and plugins/hooks/shell/apps for bounded synthetic execution.','Uses app-server protocol, not TUI; own new native history only, not existing business conversations.','No configured user profiles on this machine; named profile combinations remain a future versioned compatibility check.','WillYou production launcher, shared global catalog lock, error UI, and package upgrade remain implementation/acceptance work.'];
    report.sourceSha256=digest(self);report.finishedAt=new Date().toISOString();writeFileSync(out,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({status:report.status,cases:cases.map(({name,status})=>({name,status})),configUnchanged:report.originalFiles.every(f=>f.unchanged),output:out}));
  }
}
