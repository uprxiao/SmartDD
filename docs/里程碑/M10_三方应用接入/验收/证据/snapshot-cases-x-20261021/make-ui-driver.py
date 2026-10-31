from pathlib import Path
p=Path('/private/tmp/m10-snapshot-cases-x-20261021');p.mkdir(exist_ok=True);(p/'driver-home').mkdir(exist_ok=True)
s=Path('/private/tmp/m10-capacity-app-w-20261021/packaged-capacity-ui-next.mjs').read_text()
s=s.replace("mkdtemp('/private/tmp/willyou-m10-capacity-w-')","mkdtemp('/private/tmp/willyou-m10-snapshots-x-')").replace('m10-capacity-app-w2-package-20261021','m10-snapshot-cases-x-package-20261021').replace('m10-capacity-app-w-20261021','m10-snapshot-cases-x-20261021').replace("baseCommit:'8f022f0d84eb9ee0a5c7dc40de24a3f6c6ff2d8a'","baseCommit:'8d27a6154abf7331f6b7293d76662b3e5dabfeb9'").replace("sourceManifest:'/private/tmp/m10-launch-budget-v-20261021/source.json'","sourceManifest:'/private/tmp/m10-snapshot-cases-x-20261021/source.json'")
s=s.replace("layer:'A: unmodified V packaged App; real profile env and 1000 disabled native Skill paths trigger actual OS launch capacity; private synthetic model plain response only, no business tool/send'","layer:'A: T63 real UI creates/stops native Tasks; own DB snapshot corruption is explicit fault preparation; real UI resume refusal/history/diagnostics; private synthetic model/no business call or send'")
a=s.index('const disabledPaths=');b=s.index("await writeFile(join(state,'config.toml')",a)
s=s[:a]+'''const profileText='model="m10-ui-profile-model"\\nskills.config=[{path='+JSON.stringify(skill)+',enabled=false}]\\n';
'''+s[b:]
s=s.replace('Object.entries({...privateEnv,...pads})','Object.entries(privateEnv)').replace("'A · M10 · isolated capacity failure'","'A · M10 · T63 isolated snapshot faults'")
a=s.index(" const prompt=marker+");b=s.index(" assert.deepEqual(app.rendererErrors,[]);result.status='passed-partial';",a)
body=r'''
 const kinds=['bad-json','unknown-schema','bad-hash','cross-project-snapshot','cross-project-task'];result.cases=[];
 const manifestPath=join(root,'case-manifest.json');
 const dbCall=mode=>JSON.parse(execFileSync(executable,['/private/tmp/m10-snapshot-cases-x-20261021/snapshot-fault-db.cjs',join(userData,'smartdd.db'),mode,manifestPath],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',ELECTRON_RUN_AS_NODE:'1'},timeout:10000,maxBuffer:8*1024*1024}));
 for(const kind of kinds){
  stage='create-'+kind;await progress();await click('[data-testid=nav-home]');await app.waitFor(`!!document.querySelector('[data-testid=home-input]')`,10000);
  const prompt=marker+' '+kind+': Reply with a brief acknowledgment. Do not call tools, send mail, create drafts or contact external services.';
  await click('[data-testid=home-input]');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:prompt});assert.equal(await app.evaluate(`document.querySelector('[data-testid=home-input]').value`),prompt);await click('[data-testid=home-launch]');
  task=await poll(async()=>{const all=await app.invoke('tasks.list',{includeArchived:true});return all.find(t=>t.firstMessage===prompt)??null;},20000);result.cases.push({kind,taskId:task.id,prompt});
  await poll(async()=>{task=await app.invoke('tasks.get',task.id);return task.nativeSessionId&&task.ptyId&&(await app.output(task.ptyId)).includes(marker+'_DONE');},30000);
  await app.screenshot(join(root,kind+'-normal-task.png'));
  stage='stop-'+kind;await progress();await click('[data-testid=task-actions]');await app.waitFor(`!!document.querySelector('[data-testid=task-kill]')`,10000);await click('[data-testid=task-kill]');await poll(async()=>!(await app.invoke('tasks.get',task.id)).ptyId,15000);
  const descriptor={canary:'M10_T63_SYNTHETIC_PRIVATE_FIELD',cases:result.cases,otherProjectId:null};await writeFile(manifestPath,JSON.stringify(descriptor,null,2)+'\n');
  await poll(async()=>{const rows=dbCall('read').cases;return rows.every(c=>c.runs.length===1&&c.runs[0].state==='stopped'&&c.leaseStates.every(l=>l.state==='released'));},15000);
  checked('Created and stopped original native Task through actual UI before '+kind+' data fault',{taskId:task.id});
 }
 stage='fault-prerequisites';await progress();const otherCwd=join(root,'other-project');await mkdir(otherCwd);const other=await app.invoke('projects.create',{name:'T63 independent project',aliases:[],description:'Synthetic cross-project fault prerequisite',rulesPath:null},[{label:'independent directory',path:otherCwd}]);result.otherProjectId=other.id;
 const selection=await app.invoke('applications.select',{projectId:project.id,appId:'mail',enabled:false,expectedRevision:1,connections:{foxmail:null,smtp:null}});assert(selection.ok,selection.message);result.changedCurrentSelectionPrerequisite=true;
 const descriptor={canary:'M10_T63_SYNTHETIC_PRIVATE_FIELD',cases:result.cases,otherProjectId:other.id};await writeFile(manifestPath,JSON.stringify(descriptor,null,2)+'\n');result.fault=dbCall('fault');await writeFile(join(root,'fault-seed.json'),JSON.stringify(result.fault,null,2)+'\n');
 const pageOrigin=await app.evaluate('performance.timeOrigin');await app.cdp('Page.reload');await app.waitFor(`performance.timeOrigin!==${pageOrigin}&&document.readyState==='complete'&&!!document.querySelector('[data-testid=nav-search]')`,15000);await app.evaluate(`document.title='A · M10 · T63 isolated snapshot faults';true`);
 for(const item of result.cases){
  stage='history-'+item.kind;await progress();await click('[data-testid=nav-search]');await app.waitFor(`!!document.querySelector('[data-testid=task-search-input]')`,10000);await click('[data-testid=task-search-input]');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:marker+' '+item.kind});
  await app.waitFor(`!!document.querySelector('[data-testid=task-search-result][data-task-id="'+${JSON.stringify(item.taskId)}+'"]')`,10000);await click('[data-testid=task-search-result][data-task-id="'+item.taskId+'"]');
  await app.waitFor(`!!document.querySelector('[data-testid=task-stopped]')&&!!document.querySelector('[data-testid=task-resume]')`,15000);assert(!(await app.invoke('tasks.get',item.taskId)).ptyId);
  stage='resume-refusal-'+item.kind;await progress();await click('[data-testid=task-resume]');const reason=item.kind==='unknown-schema'?'格式暂不支持':item.kind==='bad-json'?'无法解析':item.kind==='bad-hash'?'摘要不符':'身份不符';
  await app.waitFor(`document.querySelector('[data-testid=task-stopped]')?.innerText.includes(${JSON.stringify(reason)})`,15000);const text=await app.evaluate('document.body.innerText');assert(!text.includes(descriptor.canary));item.visibleErrorReason=reason;await app.screenshot(join(root,item.kind+'-resume-refused.png'));
  stage='diagnostic-'+item.kind;await progress();await click('[data-testid=task-applications]');await app.waitFor(`!!document.querySelector('[data-testid=session-applications]')`,10000);const diagnostic=await app.invoke('applications.session',item.taskId);assert(diagnostic.ok,diagnostic.message);item.diagnostic=diagnostic.value;assert.equal(diagnostic.value.selection,item.kind==='unknown-schema'?'unsupported-schema':'corrupt');assert.equal(diagnostic.value.currentRun,null);assert.equal(diagnostic.value.agentState,'stopped');assert(!JSON.stringify(diagnostic.value).includes(descriptor.canary));const body=await app.evaluate('document.body.innerText');assert(!body.includes(descriptor.canary));assert(body.includes(item.kind==='unknown-schema'?'原能力快照格式暂不支持':'固定能力快照损坏'));await app.screenshot(join(root,item.kind+'-diagnostic.png'));await click('dialog button','关闭');
  const now=dbCall('read').cases,after=now.find(c=>c.kind===item.kind),seed=result.fault.after.find(c=>c.kind===item.kind);assert.equal(after.snapshot.snapshot_json,seed.snapshot.snapshot_json);assert.equal(after.snapshot.snapshot_hash,seed.snapshot.snapshot_hash);assert.deepEqual(after.task,seed.task);assert.deepEqual(after.refs,seed.refs);assert.deepEqual(after.identity,seed.identity);assert.deepEqual(after.runs,seed.runs);assert.equal(after.invocations,0);assert.equal(after.grants,0);assert(!after.task.runtime_snapshot.includes(descriptor.canary));item.after=after;
  checked('T63 '+item.kind+': actual history available, explicit resume refused, no replacement/new run, original bytes/refs retained and diagnostic redacted');
 }
 result.finalState=dbCall('read');await writeFile(join(root,'final-db.json'),JSON.stringify(result.finalState,null,2)+'\n');const history=await app.invoke('tasks.list',{includeArchived:true});assert.equal(history.length,5);assert(!JSON.stringify(history).includes(descriptor.canary));assert(history.every(t=>!t.ptyId));checked('All five original histories remain read-only after rejected recovery, with no application invocation or send grant');
'''
s=s[:a]+body+s[b:];s=s.replace("if(task?.id)try{result.cleanupTask=await app.invoke('tasks.kill',task.id);}catch(e){result.cleanupTaskError=String(e);}","for(const owned of result.cases??[])try{await app.invoke('tasks.kill',owned.taskId);}catch(e){result.cleanupTaskError=String(e);}")
s=s.replace("join(root,'terminal-failure.txt')","join(root,'terminal-failure.txt')")
(p/'packaged-t63-ui.mjs').write_text(s)
print('T63 driver prepared: five actual UI-created/stopped Tasks,explicit snapshot-only fault injection,and real UI recovery/history/diagnostics')
