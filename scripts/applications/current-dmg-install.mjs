// T24 local DMG installation. Reuse PM's exact bundle/data inventories, with
// an explicit newly-created root instead of changing any historical fixture.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,lstat,readlink,readdir,rename} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {installationTree} from './fixtures/dmg-install-ui.mjs';

const root=resolve(process.env.WILLYOU_INSTALL_ROOT??''),mode=process.env.WILLYOU_INSTALL_MODE??'initial';
assert(root.startsWith('/private/tmp/willyou-m10-vf-install-')&&['initial','reinstall'].includes(mode));
const input=JSON.parse(await readFile(join(root,'inputs.json'),'utf8'));assert.equal(input.root,root);
assert(input.sourceApp.startsWith('/private/tmp/willyou-m10-'));
const expected=JSON.parse(await readFile(join(root,'source-bundle-tree.json'),'utf8'));
const files=(await readdir(join(root,'dmg'))).filter(n=>n.endsWith('.dmg'));assert.equal(files.length,1);
const dmg=join(root,'dmg',files[0]),appRoot=join(root,'isolated Applications/WillYou.app'),mount=join(root,'mount-'+mode);
const sha=b=>createHash('sha256').update(b).digest('hex');
const result={schema:'m10-current-dmg-install-v1',root,mode,startedAt:new Date().toISOString(),dmg,appRoot,sourceApp:input.sourceApp,asar:input.sourceAsarSha256,dmgSha256:sha(await readFile(dmg)),status:'running',boundary:'Own readonly DMG mount and temporary Applications only;no global install/trust/quarantine change;reinstall data is from this exact structural UI batch,not an original CLI-session recovery test'};
let attached=false;
try{
 assert.equal(sha(await readFile(join(input.sourceApp,'Contents/Resources/app.asar'))),input.sourceAsarSha256);
 assert.deepEqual(await installationTree(input.sourceApp),expected,'Original verified source must remain intact');
 if(mode==='reinstall'){
  const data=process.env.WILLYOU_INSTALL_DATA_ROOT;assert(data?.startsWith('/private/tmp/willyou-m10-t22-sweep-')&&data.endsWith('/userdata'));
  const ui=JSON.parse(await readFile(join(dirname(data),'result.json'),'utf8'));
  assert.equal(ui.app,join(appRoot,'Contents/MacOS/WillYou'));assert.equal(ui.status,'passed-sweep');assert.equal(ui.quitExit.code,0);assert.equal(ui.userData,data);
  const probe=JSON.parse(execFileSync(join(appRoot,'Contents/Resources/native/willyou-process-identity'),[String(ui.appPid)],{encoding:'utf8',timeout:3000}));assert.equal(probe.state,'stopped');
  result.dataRoot=data;result.previousUi={root:ui.root,pid:ui.appPid,quitExit:ui.quitExit};
  result.dataBefore=await installationTree(data,true);result.retired=join(root,'retired/WillYou.app');await mkdir(dirname(result.retired),{recursive:true});await assert.rejects(lstat(result.retired),e=>e.code==='ENOENT');
  assert.deepEqual(await installationTree(appRoot),expected);await rename(appRoot,result.retired);await assert.rejects(lstat(appRoot),e=>e.code==='ENOENT');
 }
 await assert.rejects(lstat(appRoot),e=>e.code==='ENOENT');await mkdir(dirname(appRoot),{recursive:true});await mkdir(mount,{recursive:true});
 result.dmgVerification=execFileSync('/usr/bin/hdiutil',['verify',dmg],{encoding:'utf8',timeout:120000}).trim();
 const plist=execFileSync('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-noautoopen','-mountpoint',mount,'-plist',dmg],{encoding:'utf8',timeout:120000});attached=true;result.mountPlistSha256=sha(plist);result.applicationsLink=await readlink(join(mount,'Applications'));assert.equal(result.applicationsLink,'/Applications');
 execFileSync('/usr/bin/ditto',[join(mount,'WillYou.app'),appRoot],{timeout:120000});
 const actual=await installationTree(appRoot);assert.deepEqual(actual,expected,'Installed full bundle must exactly match the original source');result.bundleEntries=Object.keys(actual).length;
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',appRoot],{timeout:30000});result.signatureVerified=true;
 if(mode==='initial'){
  const native=execFileSync(join(appRoot,'Contents/MacOS/WillYou'),[resolve('scripts/release/native-smoke.cjs'),join(appRoot,'Contents/Resources'),'0.0.5','arm64'],{encoding:'utf8',timeout:60000,env:{PATH:process.env.PATH,TMPDIR:process.env.TMPDIR,ELECTRON_RUN_AS_NODE:'1'}});result.native=JSON.parse(native);assert(['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'].every(k=>result.native[k]==='passed'));
 }else{
  result.dataAfter=await installationTree(result.dataRoot,true);assert.deepEqual(result.dataAfter,result.dataBefore,'Reinstallation must not touch actual test-data bytes,inodes or modes');assert.deepEqual(await installationTree(result.retired),expected);result.dataUnchanged=true;
 }
 assert.deepEqual(await installationTree(input.sourceApp),expected);result.sourceUnchanged=true;result.status='passed';
}catch(error){result.status='failed';result.error=String(error);process.exitCode=1;}
finally{
 if(attached){try{execFileSync('/usr/bin/hdiutil',['detach',mount],{timeout:30000});result.detached=true;}catch(error){result.detachError=String(error);result.status='cleanup-failed';process.exitCode=1;}}
 result.finishedAt=new Date().toISOString();await writeFile(join(root,mode+'-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({root,mode,status:result.status,bundleEntries:result.bundleEntries,dataUnchanged:result.dataUnchanged,signatureVerified:result.signatureVerified,detached:result.detached,error:result.error}));
}
