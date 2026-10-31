from pathlib import Path
e=Path('/private/tmp/m10-resource-fault-ag-20261021');af=Path('/private/tmp/m10-real-cli-af-20261021')
(e/'db-read.cjs').write_text((af/'db-read.cjs').read_text().replace('willyou-m10-cli-af-','willyou-m10-cli-ag-'))
for runner,name in [('codex','codex-missing-package.mjs'),('claude','claude-missing-package-parser.mjs')]:
 s=(af/name).read_text().replace('readdir,lstat,rm}', 'readdir,lstat,rm,rename}')
 s=s.replace("const evidence='/private/tmp/m10-real-cli-af-20261021'", "const scenario=process.env.M10_AG_CASE;assert(['source-unavailable','occupied-path'].includes(scenario));\nconst evidence='/private/tmp/m10-resource-fault-ag-20261021'")
 s=s.replace("mkdtemp('/private/tmp/willyou-m10-cli-af-')", "mkdtemp('/private/tmp/willyou-m10-cli-ag-')")
 s=s.replace('/private/tmp/m10-fixed-native-ae-package-20261021/mac-arm64/WillYou.app','/private/tmp/m10-resource-fault-ag-package-20261021/WillYou.app')
 s=s.replace("commit:'7a06058fd4435a21cf5191b5ff9a66a7abc07c84'", "commit:'458d6cca78d42d3cb326fa603a6d085a478264c7',scenario,privateFaultAppClone:true")
 s=s.replace('M10_AF_', 'M10_AG_').replace('M10 AF ', 'M10 AG ')
 s=s.replace('unmodified packaged App trusted IPC','private byte-identical App clone trusted IPC with explicitly recorded source fault')
 s=s.replace("let stage='setup',app,task,project,profile;", "let stage='setup',app,task,project,profile,sourceFault;")
 s=s.replace("phase=stage.startsWith('repaired')?'REPAIRED'", "phase=stage.includes('independent')?'INDEPENDENT':stage.startsWith('repaired')?'REPAIRED'")
 if runner=='codex':
  s=s.replace("rows.some(x=>x.value.type==='event_msg'", "rows.some(x=>x.file.includes(task.nativeSessionId)&&x.value.type==='event_msg'")
  s=s.replace("async function stop(){if(!task)return;await app.invoke('tasks.kill',task.id);", "async function stop(){if(!task)return;const state=await app.invoke('applications.session',task.id);if(state.ok&&state.value.currentRun?.preparation?.state==='prepared'&&!state.value.currentRun.bridge.connected)await poll(async()=>{const d=await app.invoke('applications.session',task.id);return d.ok&&d.value.currentRun?.bridge.connected;},10000);await app.invoke('tasks.kill',task.id);")
 a=s.index(' await rm(target,{recursive:true});result.fault=');b=s.index("task=(await app.invoke('tasks.open'",a)
 fault=""" await rm(target,{recursive:true});
 if(scenario==='source-unavailable'){
  const sourceRoot=join(appRoot,'Contents/Resources/capability-bundles'),index=JSON.parse(await readFile(join(sourceRoot,'index.json'),'utf8')),entry=index.apps.find(a=>a.hash===hash);assert(entry);const path=join(sourceRoot,entry.path),quarantine=join(root,'quarantined-original-distribution');const files=await tree(path);await rename(path,quarantine);sourceFault={path,quarantine,files,at:new Date().toISOString()};result.sourceFault=sourceFault;
 }else{await mkdir(target);await writeFile(join(target,'user.txt'),marker+'_OWN_USER_CONTENT_KEEP');result.userTree=await tree(target);}
 result.fault={at:new Date().toISOString(),target,scenario,boundary:scenario==='source-unavailable'?'Only this App clone configured original source is moved to quarantine outside its source list, and own stopped Task C bytes removed. Accepted App unchanged. No claim all identical bytes anywhere on disk were destroyed.':'Original C target replaced by private user content;trusted distribution intact;must not overwrite user data.'};
 await close();stage='unavailable-bootstrap';await start();const support=await app.invoke('agentSupport.status');result.unavailableSupport=support;assert.equal(support.state,'partial');assert.equal(support.applications.find(a=>a.appId==='mail').filesReady,false);assert.equal(support.applications.find(a=>a.appId==='zentao').filesReady,true);
 const boot=dbRead();result.faultBootstrap=boot;assert.deepEqual(boot.snapshot,before.snapshot);assert.deepEqual(boot.identity,before.identity);assert.deepEqual(boot.refs,before.refs);assert.deepEqual(boot.defaults,before.defaults);assert.deepEqual(boot.proofs,before.proofs);assert.equal(boot.resources.find(a=>a.resource_id===pack.resource_id).generation,before.resources.find(a=>a.resource_id===pack.resource_id).generation);assert.equal(boot.restoration.length,0);
 if(scenario==='source-unavailable'){let absent=false;try{await lstat(target);}catch(error){assert.equal(error.code,'ENOENT');absent=true;}assert(absent);}else assert.deepEqual(await tree(target),result.userTree);
 checked('Faulted restart retains original version/refs/defaults without a configured trusted source or without overwriting occupied user path');
 stage='unavailable-cli';await progress();"""
 s=s[:a]+fault+s[b:]
 # Both original and independent continuations must keep the fixed unavailable version visible.
 needle="assert.equal(unavailable.value.currentRun.bridge.connected,false);"
 s=s.replace(needle,needle+"assert.equal(unavailable.value.applications.find(a=>a.packageHash===hash).fixedVersion,pack.version);assert.equal(unavailable.value.applications.find(a=>a.packageHash===hash).resourceState,'unavailable');")
 a=s.index(" await stop();await close();stage='repaired-startup'");b=s.index("}catch(error)",a)
 repaired=s[a:b]
 # Preserve the ordinary repaired branch for the source fault only.
 repaired=repaired.replace("await close();stage='repaired-startup'", "await close();await rename(sourceFault.quarantine,sourceFault.path);sourceFault.restoredAt=new Date().toISOString();assert.deepEqual(await tree(sourceFault.path),sourceFault.files);stage='repaired-startup'")
 independent=""" await stop();const originalTaskId=task.id;stage='unavailable-independent';await progress();const independent=await app.invoke('tasks.create',{projectId:project.id,dirId:null,aiProfileId:profile.id,firstMessage:marker+'_INDEPENDENT: Reply briefly only. Do not use tools or perform any action.',cols:120,rows:35});task=independent.task;
 """+("await attachTerminalModel(app,task,result);" if runner=='claude' else '')+"""await complete('INDEPENDENT');assert.notEqual(task.nativeSessionId,before.task.native_session_id);assert(task.runtimeSnapshot.selfCheck.issues.includes('CAPABILITY_UNAVAILABLE'));result.independentTask=task;await stop();result.independentDb=dbRead();assert(result.independentDb.runs.every(r=>r.state==='stopped'));assert(result.independentDb.leases.every(l=>l.state==='released'));task=await app.invoke('tasks.get',originalTaskId);assert.equal(task.nativeSessionId,before.task.native_session_id);assert.deepEqual(dbRead().snapshot,before.snapshot);checked('Independent new native Task succeeds while the old fixed unavailable history and identity remain unchanged');
 """
 occupied=""" await stop();result.final=dbRead();assert.deepEqual(result.final.snapshot,before.snapshot);assert.deepEqual(result.final.identity,before.identity);assert.deepEqual(result.final.refs,before.refs);assert.deepEqual(result.final.defaults,before.defaults);assert.equal(result.final.runs.length,2);assert.equal(result.final.invocation.length,0);assert.equal(result.final.grantCount,0);assert.deepEqual(await tree(target),result.userTree);assert.equal(await readFile(join(target,'user.txt'),'utf8'),marker+'_OWN_USER_CONTENT_KEEP');checked('Occupied user path remains byte-identical, no repair operation or call/grant added, both native Tasks retain separate identities');result.status='passed-partial';
 """
 s=s[:a]+independent+" if(scenario==='source-unavailable'){\n"+repaired+"\n }else{\n"+occupied+"\n }\n"+s[b:]
 # Restore only the owned clone source even if a test assertion fails.
 needle="await close();for(const s of sockets)s.destroy();"
 restore="""await close();if(sourceFault&&!sourceFault.restoredAt)try{await lstat(sourceFault.quarantine);let present=false;try{await lstat(sourceFault.path);present=true;}catch(error){assert.equal(error.code,'ENOENT');}assert(!present,'Unexpected occupation at owned clone source restore target');await rename(sourceFault.quarantine,sourceFault.path);sourceFault.restoredAt=new Date().toISOString();assert.deepEqual(await tree(sourceFault.path),sourceFault.files);}catch(error){result.cleanupSourceError=String(error);process.exitCode=1;result.status='failed';}for(const s of sockets)s.destroy();"""
 assert needle in s;s=s.replace(needle,restore)
 # Unique result handles for all scenario/runner pairs.
 if runner=='codex':
  s=s.replace("join(root,'result.json')", "join(root,'result-'+scenario+'-codex.json')").replace("join(evidence,'result-path.txt')", "join(evidence,scenario+'-codex-result-path.txt')")
 else:
  s=s.replace("join(root,'result-claude-parser.json')", "join(root,'result-'+scenario+'-claude.json')").replace("join(evidence,'claude-parser-result-path.txt')", "join(evidence,scenario+'-claude-result-path.txt')")
 (e/(runner+'-resource-cases.mjs')).write_text(s)
print('Generated Codex/Claude resource fault drivers with independent scenario roots.')
