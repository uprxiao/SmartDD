import http from 'node:http';import {mkdtempSync,mkdirSync,writeFileSync,cpSync,realpathSync,existsSync} from 'node:fs';import {join} from 'node:path';
import {PluginProcess,validateManifest,treeHash} from './host-sim.mjs';
import {fileURLToPath} from 'node:url';const SRC=fileURLToPath(new URL('./demo-tracker',import.meta.url));
const root=realpathSync(mkdtempSync('/tmp/m13-plugin-'));const out={cases:{}};const rec=(k,v)=>{out.cases[k]=v;console.error(k,JSON.stringify(v).slice(0,220));};
const tryc=async f=>{try{return {ok:true,value:await f()}}catch(e){return {ok:false,error:String(e.message).slice(0,200)}}};
// mock tracker API
const TOKEN='tok-'+Math.random().toString(36).slice(2);
const api=http.createServer((q,r)=>{if(q.headers.authorization!=='Bearer '+TOKEN){r.writeHead(401);r.end();return;}const u=new URL(q.url,'http://x');
 if(u.pathname==='/api/me'){r.end(JSON.stringify({account:'alice'}));return;}
 if(u.pathname==='/api/bugs'){r.end(JSON.stringify([{id:101,title:'登录页报错',severity:2,openedAt:'2026-11-01T08:00:00Z',url:'http://tracker/bug/101'},{id:102,title:'导出超时',severity:3,openedAt:'2026-11-02T08:00:00Z',url:'http://tracker/bug/102'}]));return;}
 r.writeHead(404);r.end();});
await new Promise(x=>api.listen(0,'127.0.0.1',x));const conn={config:{baseUrl:`http://127.0.0.1:${api.address().port}`,account:'alice'},secret:TOKEN};
// 1 install: copy into plugins/<id>/<version>/, hash
const installDir=join(root,'userData/plugins/demo-tracker/0.1.0');mkdirSync(installDir,{recursive:true});cpSync(SRC,installDir,{recursive:true});
rec('I1_install',{srcHash:treeHash(SRC),installedHash:treeHash(installDir),manifest:validateManifest(installDir).ok});
// manifest negatives
for(const [name,mut] of [['bad-id',m=>m.id='Demo_Tracker'],['cap-prefix',m=>{m.capabilities['other.x']=m.capabilities['demo-tracker.bugs.list']}],['entry-escape',m=>m.runtime.entry='../../evil.mjs'],['hostApi-2',m=>m.hostApi=2],['panel-unknown',m=>m.ui.panels[0].source.capability='demo-tracker.nope']]){
 const d=join(root,'neg-'+name);cpSync(SRC,d,{recursive:true});const p=join(d,'.willyou-plugin/plugin.json');const m=JSON.parse((await import('node:fs')).readFileSync(p,'utf8'));mut(m);writeFileSync(p,JSON.stringify(m));rec('I2_manifest_'+name,validateManifest(d));}
// decoy host files
const fakeUserData=join(root,'userData');writeFileSync(join(fakeUserData,'smartdd.db'),'DECOY-HOST-DB');
const dataDir=join(fakeUserData,'plugin-data/demo-tracker');mkdirSync(dataDir,{recursive:true});
const pp=new PluginProcess(installDir,dataDir,{timeoutMs:2000});await pp.load();
rec('R1_initialize',await tryc(()=>pp.call('initialize',{})));
rec('R2_verify_ok',await tryc(()=>pp.call('verify',conn)));
rec('R3_verify_badtoken',await tryc(()=>pp.call('verify',{...conn,secret:'wrong'})));
rec('R4_execute_normal',await tryc(()=>pp.execute('demo-tracker.bugs.list',{status:'active'},conn)));
rec('R5_input_rejected_by_host',await tryc(()=>pp.execute('demo-tracker.bugs.list',{status:'nope'},conn)));
rec('R6_output_rejected_by_host',await tryc(()=>pp.execute('demo-tracker.bugs.list',{mode:'bad-output'},conn)));
const s0=pp.starts;rec('F1_crash',await tryc(()=>pp.execute('demo-tracker.bugs.list',{mode:'crash'},conn)));
rec('F1b_after_crash_auto_restart',{...(await tryc(()=>pp.execute('demo-tracker.bugs.list',{},conn))),startsDelta:pp.starts-s0});
const t0=Date.now();rec('F2_hang_timeout',{...(await tryc(()=>pp.execute('demo-tracker.bugs.list',{mode:'hang'},conn))),ms:Date.now()-t0});
rec('F2b_after_hang',{...(await tryc(()=>pp.execute('demo-tracker.bugs.list',{},conn))),starts:pp.starts});
const probe=await tryc(()=>pp.execute('demo-tracker.bugs.list',{mode:'probe',probePath:join(fakeUserData,'smartdd.db')},conn));
rec('S1_probe_no_sandbox',probe.ok?probe.value.probe:probe);pp.stop();
// sandbox variant: deny reading userData except own data dir
const profile=`(version 1)(allow default)(deny file-read-data file-write* (require-all (subpath "${fakeUserData}") (require-not (subpath "${installDir}")) (require-not (subpath "${dataDir}"))))(deny file-write* (subpath "${installDir}"))`;
const sp=new PluginProcess(installDir,dataDir,{timeoutMs:4000,sandboxProfile:profile});await sp.load();
const sprobe=await tryc(()=>sp.execute('demo-tracker.bugs.list',{mode:'probe',probePath:join(fakeUserData,'smartdd.db')},conn));
rec('S2_probe_sandbox',sprobe.ok?{readHostFile:sprobe.value.probe.readHostFile,readError:sprobe.value.probe.readError}:sprobe);
rec('S3_sandbox_normal_execute_with_network',await tryc(()=>sp.execute('demo-tracker.bugs.list',{},conn)));
const own=await tryc(()=>sp.execute('demo-tracker.bugs.list',{mode:'probe',probePath:join(installDir,'.willyou-plugin/plugin.json')},conn));
const sshp=process.env.HOME+'/.ssh/known_hosts';const ssh=await tryc(()=>sp.execute('demo-tracker.bugs.list',{mode:'probe',probePath:sshp},conn));rec('S5_sandbox_read_other_user_file',ssh.ok?{readHostFile:ssh.value.probe.readHostFile,readError:ssh.value.probe.readError}:ssh);
rec('S4_sandbox_read_own_package',own.ok?{readHostFile:own.value.probe.readHostFile,readError:own.value.probe.readError}:own);
sp.stop();api.close();
const txt=JSON.stringify(out,null,1).replaceAll(root,'<tmp>').replaceAll(TOKEN,'<token>');writeFileSync(join(root,'result.json'),txt);console.log(txt);
