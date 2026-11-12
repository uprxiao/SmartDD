import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {existsSync,mkdirSync,readFileSync,realpathSync,symlinkSync,writeFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {expect,it} from 'vitest';
import {PluginProcess,PluginProcessBudget} from '../process';
import {pluginHostReadOnlyRoots} from '../host-paths';
import {validatePluginBundle} from '../package';
import {fixture} from './fixture';
import {digest} from '../../manifest';
import {MacProcessIdentityReader,type ProcessIdentity} from '../../process-identity';

/** Explicit S-layer component test. Never runs by default. The private native
 * wrapper can only touch one fixed, public synthetic Keychain item, never user
 * credentials. It is outside the plugin package and not shipped with WillYou.
 */
it.runIf(process.platform==='darwin'&&!!process.env.WILLYOU_P1_SYSTEM_KEYCHAIN_REVIEW)('denies direct Security.framework access from the signed packaged Electron plugin including alias reads and writes while the same engine can access its synthetic item outside Seatbelt',async()=>{
 const reviewPath=process.env.WILLYOU_P1_SYSTEM_KEYCHAIN_REVIEW!;
 if(!reviewPath.startsWith('/private/tmp/willyou-m13-p1-keychain-')||!reviewPath.endsWith('/prepared-review.json'))throw Error('Private reviewed Keychain fixture required');
 const review=JSON.parse(readFileSync(reviewPath,'utf8')) as {root:string;service:string;account:string;publicMarker:string;keychain:string;keychainAlias:string;executable:string;probe:string;probeSha256:string;executableSha256:string;sourceSha256:string;baselineScriptSha256:string;appAsarSha256:string};
 const root=realpathSync(review.root),evidencePath=join(root,'system-result.json');
 expect(dirname(reviewPath)).toBe(root);expect(review.service).toMatch(/^com\.smartdd\.p1\.synthetic\.[a-f0-9]{32}$/);const nonce=review.service.split('.').at(-1)!;expect(review.account).toBe('p1-'+nonce);expect(review.publicMarker).toBe('P1-PUBLIC-SYNTHETIC-NOT-A-CREDENTIAL-'+nonce);
 expect(realpathSync(review.keychainAlias)).toBe(realpathSync(review.keychain));expect(review.keychainAlias).toBe(join(root,'keychain-alias'));expect(realpathSync(review.probe)).toBe(join(root,'probe/keychain.node'));expect(review.executable).toMatch(/^\/private\/tmp\/willyou-m13-p1-App[0-9]{3}\/mac-arm64\/WillYou\.app\/Contents\/MacOS\/WillYou$/);
 expect(digest(readFileSync(review.probe))).toBe(review.probeSha256);expect(digest(readFileSync(join(root,'probe/keychain.cc')))).toBe(review.sourceSha256);expect(digest(readFileSync(join(root,'probe/baseline.cjs')))).toBe(review.baselineScriptSha256);expect(digest(readFileSync(review.executable))).toBe(review.executableSha256);
 const appAsar=join(dirname(dirname(review.executable)),'Resources/app.asar'),physicalFs=createRequire(import.meta.url)('original-fs') as typeof import('node:fs');expect(digest(physicalFs.readFileSync(appAsar))).toBe(review.appAsarSha256);
 const host=join(root,'host'),pack=join(host,'plugins/demo-tracker/0.1.0'),data=join(host,'plugin-data/demo-tracker');for(const p of [pack,data,...['home','tmp','config','cache'].map(p=>join(data,p))])mkdirSync(p,{recursive:true,mode:0o700});
 const evidence:Record<string,unknown>={schema:1,review:reviewPath,root,service:review.service,account:review.account,publicSyntheticOnly:true,appMainStarted:false,pluginInstalled:false,packagedAppUi:false,nativeTestWrapperOutsidePackage:true,phase:'preflight',baselines:[]};
 const save=()=>writeFileSync(evidencePath,JSON.stringify(evidence,null,2)+'\n');
 const env={PATH:'/usr/bin:/bin',HOME:join(data,'home'),TMPDIR:join(data,'tmp'),XDG_CONFIG_HOME:join(data,'config'),XDG_CACHE_HOME:join(data,'cache'),XDG_DATA_HOME:data,ELECTRON_RUN_AS_NODE:'1',WILLYOU_PLUGIN_DATA:data,WILLYOU_PLUGIN_ID:'demo-tracker'};
 const native=(phase:string,action:'read'|'read-alias'|'create'|'delete')=>{
  const result=spawnSync(review.executable,[join(root,'probe/baseline.cjs'),action],{cwd:data,env,encoding:'utf8',timeout:10000,maxBuffer:65536});
  const raw={phase,action,code:result.status,signal:result.signal,error:result.error?.message,stdout:result.stdout,stderr:result.stderr};(evidence.baselines as unknown[]).push(raw);save();
  expect(result.error).toBeUndefined();expect(result.status).toBe(0);const parsed=JSON.parse(result.stdout.trim()) as {electron:string;executable:string;keychain:{status:number;openStatus?:number;keychainUnlocked?:boolean;matchesPublicSynthetic?:boolean}};expect(parsed.electron).toBe('42.11.14');expect(parsed.executable).toBe(review.executable);return parsed.keychain;
 };
 let child:PluginProcess|undefined,created=false,createAttempted=false,identity:ProcessIdentity|null=null,passed=false;
 const reader=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),budget=new PluginProcessBudget();
 try{
  const before=native('preflight','read');expect(before.openStatus).toBe(0);expect(before.keychainUnlocked).toBe(true);expect(before.status).toBe(-25300);expect(before.matchesPublicSynthetic).toBe(false);
  evidence.phase='create-public-synthetic-item';createAttempted=true;save();const added=native('create','create');expect(added.status).toBe(0);created=true;
  const baseline=native('before-sandbox','read');expect(baseline.status).toBe(0);expect(baseline.matchesPublicSynthetic).toBe(true);const aliasBaseline=native('alias-before-sandbox','read-alias');expect(aliasBaseline.status).toBe(0);expect(aliasBaseline.matchesPublicSynthetic).toBe(true);
  const fakeDb=join(host,'smartdd-fake.db'),other=join(host,'plugin-data/other/sentinel.txt'),alias=join(data,'host-alias');mkdirSync(dirname(other),{recursive:true,mode:0o700});writeFileSync(other,'OTHER_PUBLIC_SYNTHETIC');symlinkSync(fakeDb,alias);
  const db=new DatabaseSync(fakeDb);db.exec("CREATE TABLE sentinel(value TEXT);INSERT INTO sentinel VALUES('HOST_PUBLIC_SYNTHETIC')");db.close();const dbHash=digest(readFileSync(fakeDb));
  const f=fixture();f.manifest.permissions=[];f.manifest.providers=[];f.manifest.ui.panels=[];f.manifest.capabilities['demo-tracker.items.list'].slots=[];
  f.files.set('schemas/input.json',Buffer.from(JSON.stringify({type:'object',additionalProperties:false,required:['probe','hostDb','other','alias'],properties:{action:{type:'string',enum:['read','read-alias','create']},probe:{type:'string'},hostDb:{type:'string'},other:{type:'string'},alias:{type:'string'}}})));f.files.set('schemas/output.json',Buffer.from('{"type":"object"}'));
  f.files.set('runtime/main.mjs',Buffer.from(`import readline from 'node:readline';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import {DatabaseSync} from 'node:sqlite';const require=createRequire(import.meta.url);const attempt=f=>{try{f();return 'allowed'}catch(e){return e.code}};readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);let result;if(m.method==='initialize')result={protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:'0.1.0'};else{const i=m.params.input,probe=require(i.probe),db=new DatabaseSync(join(process.env.WILLYOU_PLUGIN_DATA,'own.sqlite'));db.exec("CREATE TABLE IF NOT EXISTS items(value TEXT);INSERT INTO items VALUES('OWN_PUBLIC_SYNTHETIC')");const rows=db.prepare('SELECT value FROM items').all();db.close();const child=spawnSync('/usr/bin/true',[],{encoding:'utf8'});result={electron:process.versions.electron,executable:process.execPath,probeLoaded:true,keychain:({read:probe.readSynthetic,'read-alias':probe.readSyntheticAlias,create:probe.createSynthetic}[i.action||'read'])(),hostRead:attempt(()=>readFileSync(i.hostDb)),otherRead:attempt(()=>readFileSync(i.other)),aliasRead:attempt(()=>readFileSync(i.alias)),ownRows:rows,child:{code:child.error?.code,status:child.status}};}process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`));
  const plugin=validatePluginBundle(f.bundle());expect([...plugin.files.keys()].some(p=>p.endsWith('.node'))).toBe(false);for(const[path,bytes]of plugin.files){const target=join(pack,path);mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,bytes,{mode:0o600});}
  evidence.phase='sandboxed-signed-electron-query';save();child=new PluginProcess(plugin,{packageRoot:pack,dataRoot:data,protectedRoots:[host],readOnlyRoots:[...pluginHostReadOnlyRoots(appAsar,review.executable),join(root,'probe')],keychainRoots:[dirname(review.keychain)],executable:review.executable,budget,onSpawn:pid=>{evidence.pluginPid=pid;save();},onClose:receipt=>{evidence.closeReceipt=receipt;save();}});
  const result=await child.execute('demo-tracker.items.list',{probe:review.probe,hostDb:fakeDb,other,alias},{});evidence.pluginResult=result;identity=reader.read(child.pid!);evidence.nativeIdentity=identity;save();
  expect(identity).not.toBeNull();expect(result).toMatchObject({electron:'42.11.14',executable:review.executable,probeLoaded:true,keychain:{matchesPublicSynthetic:false},hostRead:'EPERM',otherRead:'EPERM',aliasRead:'EPERM',ownRows:[{value:'OWN_PUBLIC_SYNTHETIC'}],child:{code:'EPERM'}});expect((result as {keychain:{status:number}}).keychain.status).not.toBe(0);expect(digest(readFileSync(fakeDb))).toBe(dbHash);
  const aliasResult=await child.execute('demo-tracker.items.list',{probe:review.probe,hostDb:fakeDb,other,alias,action:'read-alias'},{});evidence.pluginAliasResult=aliasResult;save();expect(aliasResult).toMatchObject({probeLoaded:true,keychain:{matchesPublicSynthetic:false}});expect((aliasResult as {keychain:{status:number}}).keychain.status).not.toBe(0);
  const after=native('after-sandbox','read');expect(after.status).toBe(0);expect(after.matchesPublicSynthetic).toBe(true);
  // A duplicate-item error cannot prove write isolation. First delete our exact
  // item and verify absence, then attempt creation inside the same sandbox.
  expect(native('before-write-delete-own','delete').status).toBe(0);created=false;expect(native('before-write-confirm-absent','read').status).toBe(-25300);
  evidence.phase='sandboxed-create-when-absent';save();const writeResult=await child.execute('demo-tracker.items.list',{probe:review.probe,hostDb:fakeDb,other,alias,action:'create'},{});evidence.pluginWriteResult=writeResult;save();expect((writeResult as {keychain:{status:number}}).keychain.status).not.toBe(0);expect((writeResult as {keychain:{status:number}}).keychain.status).not.toBe(-25299);expect(native('after-sandbox-write-confirm-absent','read').status).toBe(-25300);
  // Positive write control under the same signature, HOME, database and item
  // identity verifies that missing setup or a locked database did not cause it.
  expect(native('after-sandbox-write-positive-control','create').status).toBe(0);created=true;const writeControl=native('after-write-positive-control-read','read');expect(writeControl.status).toBe(0);expect(writeControl.matchesPublicSynthetic).toBe(true);evidence.phase='verified';passed=true;
 }catch(error){evidence.failure={message:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:undefined};throw error;}
 finally{
  const cleanup:Record<string,unknown>={};
  try{await child?.close();cleanup.budgetActive=budget.active;if(identity)cleanup.nativeState=reader.state(identity);expect(budget.active).toBe(0);if(identity)expect(cleanup.nativeState).toBe('stopped');
   if(createAttempted){const current=native('cleanup-ownership-check','read');if(created||current.matchesPublicSynthetic===true){expect(current.matchesPublicSynthetic).toBe(true);const deleted=native('delete-own-item','delete');expect(deleted.status).toBe(0);cleanup.itemDeleted=true;const absent=native('after-delete','read');expect(absent.status).toBe(-25300);expect(absent.matchesPublicSynthetic).toBe(false);cleanup.itemAbsent=true;}else if(current.status===-25300)cleanup.itemAbsent=true;else throw Error('Synthetic item ownership/creation outcome unknown; preserve for review');}
   expect(digest(physicalFs.readFileSync(appAsar))).toBe(review.appAsarSha256);cleanup.appAsarUnchanged=true;expect(digest(readFileSync(review.probe))).toBe(review.probeSha256);cleanup.probeUnchanged=true;
  }catch(error){cleanup.error=error instanceof Error?error.message:String(error);passed=false;}
  evidence.cleanup=cleanup;evidence.createdItem=created;evidence.status=passed?'passed':'failed';save();expect(cleanup).not.toHaveProperty('error');
 }
},60000);
