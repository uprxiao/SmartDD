from pathlib import Path
import sys
prior_path=sys.argv[1] if len(sys.argv)>1 else '/private/tmp/willyou-m10-snapshots-x-8WvIfw/result.json'
prior_count=int(sys.argv[2]) if len(sys.argv)>2 else 3
suffix=sys.argv[3] if len(sys.argv)>3 else 'continuation'
p=Path('/private/tmp/m10-snapshot-cases-x-20261021');s=(p/'packaged-t63-ui.mjs').read_text()
old="const root=await mkdtemp('/private/tmp/willyou-m10-snapshots-x-');";new="""const prior=JSON.parse(await readFile('/private/tmp/willyou-m10-snapshots-x-8WvIfw/result.json','utf8'));
assert.equal(prior.status,'deferred-focus-loss');assert(!prior.fault);assert.equal(prior.cases.length,3);
const root=prior.root;assert.equal(root,'/private/tmp/willyou-m10-snapshots-x-8WvIfw');""";assert old in s;s=s.replace(old,new,1)
needle="assert.equal(result.asarSha256,packageReceipt.asarSha256);";assert needle in s;s=s.replace(needle,needle+"assert.equal(result.asarSha256,prior.asarSha256);result.sameBatchContinuation={priorResult:root+'/result.json',sameSourceAndPackage:true,noPriorFaultInjection:true};",1)
old="await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;";new="""const originalConfig=await readFile(join(state,'config.toml'),'utf8');const endpoint=/base_url="(http:\/\/127\\.0\\.0\\.1:\\d+\/v1)"/.exec(originalConfig);assert(endpoint,'Expected own original loopback provider');
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(new URL(endpoint[1]).port),'127.0.0.1',resolve);});const port=server.address().port;""";assert old in s;s=s.replace(old,new,1)
old="await writeFile(join(state,'config.toml'),config);await writeFile(join(state,'m10-native.config.toml'),profileText);";new="assert.equal(await readFile(join(state,'config.toml'),'utf8'),config);assert((await readFile(join(state,'m10-native.config.toml'),'utf8')).startsWith(profileText));";assert old in s;s=s.replace(old,new,1)
a=s.index(" stage='prerequisites';");b=s.index(" stage='composer';",a);s=s[:a]+" stage='prior-prerequisites';await progress();project={id:prior.projectId};profile={id:prior.profileId};result.projectId=project.id;result.profileId=profile.id;result.priorHealth=prior.profileHealth;\n"+s[b:]
s=s.replace("const kinds=['bad-json','unknown-schema','bad-hash','cross-project-snapshot','cross-project-task'];result.cases=[];", "const kinds=['bad-json','unknown-schema','bad-hash','cross-project-snapshot','cross-project-task'];result.cases=JSON.parse(JSON.stringify(prior.cases));")
needle=" for(const kind of kinds){\n  stage='create-'";replacement=""" await writeFile(manifestPath,JSON.stringify({cases:result.cases,canary:'M10_T63_SYNTHETIC_PRIVATE_FIELD',otherProjectId:null},null,2)+'\\n');
 stage='own-startup-recovery';await progress();result.recoveredPrecondition=await poll(async()=>{const v=dbCall('read');return v.cases.every(c=>c.runs.length===1&&c.runs[0].state==='stopped'&&c.leaseStates.every(l=>l.state==='released'))?v:null;},15000);
 checked('Recovered only the prior batch stopped native Tasks after focus yield;no replay or additional run');
 for(const kind of kinds){
  if(result.cases.some(c=>c.kind===kind))continue;
  stage='create-'""";assert needle in s;s=s.replace(needle,replacement,1)
# Reinstall passive output after every renderer navigation, including the fault-only view.
needle="await app.evaluate(`document.title='A · M10 · T63 isolated snapshot faults';true`);\n for(const item";replacement="await app.evaluate(`document.title='A · M10 · T63 isolated snapshot faults';window.__m5={output:{},exits:{}};window.electronAPI.eventOn('pty:data',e=>{window.__m5.output[e.ptyId]=(window.__m5.output[e.ptyId]||'')+e.data});window.electronAPI.eventOn('pty:exit',e=>{window.__m5.exits[e.ptyId]=e.code});true`);\n for(const item";assert needle in s;s=s.replace(needle,replacement,1)
s=s.replace("join(root,'progress.json')","join(root,'progress-continuation.json')").replace("join(root,'result.json')","join(root,'result-continuation.json')").replace("join(root,'electron.txt')","join(root,'electron-continuation.txt')").replace("join(root,'failure.png')","join(root,'failure-continuation.png')").replace("join(root,'terminal-failure.txt')","join(root,'terminal-failure-continuation.txt')")
s=s.replace('progress-continuation.json','progress-'+suffix+'.json').replace('result-continuation.json','result-'+suffix+'.json').replace('/private/tmp/willyou-m10-snapshots-x-8WvIfw/result.json',prior_path).replace("priorResult:root+'/result.json'",'priorResult:'+repr(prior_path)).replace('prior.cases.length,3','prior.cases.length,'+str(prior_count)).replace('electron-continuation.txt','electron-'+suffix+'.txt').replace('failure-continuation.png','failure-'+suffix+'.png').replace('terminal-failure-continuation.txt','terminal-failure-'+suffix+'.txt')
(p/('packaged-t63-ui-'+suffix+'.mjs')).write_text(s);print('exact-source/package continuation prepared for explicit prior root; provider rebound to prior private URL; no new profile/duplicate Task recreation')
