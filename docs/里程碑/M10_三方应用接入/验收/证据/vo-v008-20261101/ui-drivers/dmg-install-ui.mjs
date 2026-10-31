// PM: isolated DMG copy installation and removal/reinstallation only.
// The caller must have normally quit its own App and stopped its real task first.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,readdir,lstat,readlink,rename,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
const ownRoot='/private/tmp/willyou-m10-pm-20261028';
function installationRoot(dmg,appRoot){
 const root=dirname(dirname(resolve(dmg)));
 assert(root===ownRoot||/^\/private\/tmp\/willyou-m10-vf-install-[A-Za-z0-9]+$/.test(root));
 assert.equal(resolve(dmg),join(root,'dmg/WillYou-0.0.8-mac-arm64.dmg'));
 assert.equal(resolve(appRoot),join(root,'isolated Applications/WillYou.app'));
 return root;
}
export async function installationTree(root,identities=false){
 const tree={};async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  const p=join(dir,entry.name),s=await lstat(p),v={mode:s.mode&0o777};
  if(identities)Object.assign(v,{dev:s.dev,ino:s.ino,uid:s.uid,gid:s.gid});
  if(s.isSymbolicLink())v.link=await readlink(p);
  else if(s.isDirectory()){v.directory=true;await visit(p);}
  else{assert(s.isFile());Object.assign(v,{bytes:s.size,sha256:sha(await readFile(p))});}
  tree[p.slice(root.length+1)]=v;
 }}await visit(root);return Object.fromEntries(Object.entries(tree).sort(([a],[b])=>a.localeCompare(b)));
}
export async function installOwnDmg({dmg,appRoot,label}){
 const ownRoot=installationRoot(dmg,appRoot);
 assert(label==='initial'||/^reinstall-[1-9][0-9]*$/.test(label));
 await assert.rejects(lstat(appRoot),error=>error.code==='ENOENT');
 const mount=join(ownRoot,'mount-'+label);await mkdir(mount,{recursive:true});await mkdir(dirname(appRoot),{recursive:true});
 let attached=false;const record={label,dmg,appRoot,mount,dmgSha256:sha(await readFile(dmg)),boundary:'readonly own DMG mount and ditto into own temporary Applications;no global install/trust/quarantine mutation'};
 try{
  const raw=execFileSync('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-noautoopen','-mountpoint',mount,'-plist',dmg],{encoding:'utf8',timeout:120000});attached=true;
  record.attachPlist=raw;assert((await lstat(join(mount,'WillYou.app'))).isDirectory());
  record.applicationsLink=await readlink(join(mount,'Applications'));assert.equal(record.applicationsLink,'/Applications');
  execFileSync('/usr/bin/ditto',[join(mount,'WillYou.app'),appRoot],{timeout:120000});
  record.bundle=await installationTree(appRoot);
  const inventory=ownRoot==='/private/tmp/willyou-m10-pm-20261028'?'original-bundle-inventory.json':'source-bundle-tree.json';
  const expected=JSON.parse(await readFile(join(ownRoot,inventory),'utf8'));assert.deepEqual(record.bundle,expected,'Installed bundle exactly matches this root\'s pinned verified package');
  execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',appRoot],{timeout:30000});record.signatureVerified=true;
 }finally{
  if(attached){execFileSync('/usr/bin/hdiutil',['detach',mount],{timeout:30000});record.detached=true;}
 }
 await writeFile(join(ownRoot,label+'-installation.json'),JSON.stringify(record,null,2)+'\n');return record;
}
export async function cycleOwnInstallation({dmg,appRoot,userData,home,state,cwd,previousPid,result}){
 const ownRoot=installationRoot(dmg,appRoot);
 assert(userData.startsWith('/private/tmp/willyou-m10-native-terminal-')&&Buffer.byteLength(userData)===315);
 for(const p of [home,state,cwd])assert(p.startsWith('/private/tmp/willyou-m10-native-terminal-'));
 assert(Number.isSafeInteger(previousPid)&&previousPid>1);
 assert.throws(()=>process.kill(previousPid,0),error=>error.code==='ESRCH','Original normally quit App must be absent');
 const e=result.dmgInstallation={status:'running',previousPid,appRoot,dmg,retiredApp:join(ownRoot,'removed-original-'+previousPid+'/WillYou.app'),before:{},boundary:'External own-bundle removal/reinstall between normal quit and original same-U native resume;not cross-version upgrade or destructive data uninstall'};
 for(const p of [userData,home,state,cwd])e.before[p]=await installationTree(p,true);
 await mkdir(dirname(e.retiredApp),{recursive:true});await assert.rejects(lstat(e.retiredApp),error=>error.code==='ENOENT');
 const original=await installationTree(appRoot);await rename(appRoot,e.retiredApp);await assert.rejects(lstat(appRoot),error=>error.code==='ENOENT');assert.deepEqual(await installationTree(e.retiredApp),original);
 e.removed=true;for(const [p,tree]of Object.entries(e.before))assert.deepEqual(await installationTree(p,true),tree);
 const installed=await installOwnDmg({dmg,appRoot,label:'reinstall-'+previousPid});e.reinstall={dmgSha256:installed.dmgSha256,signatureVerified:installed.signatureVerified,detached:installed.detached,bundleEntries:Object.keys(installed.bundle).length};
 e.after={};for(const [p,tree]of Object.entries(e.before)){e.after[p]=await installationTree(p,true);assert.deepEqual(e.after[p],tree);}
 assert.deepEqual(await installationTree(appRoot),original);e.status='passed-original-app-removed-reinstalled-data-inodes-hashes-preserved';
 await writeFile(join(ownRoot,'reinstall-data-preservation.json'),JSON.stringify(e,null,2)+'\n');return e;
}
// Initial activation of a newly launched own App only, before its input guard.
// Never applied to an instance whose guard yielded; that instance is terminal.
export async function focusNewInstalledWindow(app,userData,result){
 const before=await app.evaluate('({focused:document.hasFocus(),visibility:document.visibilityState})');
 const record={pid:app.processId,before,requested:false};(result.installationInitialFocus??=[]).push(record);
 if(!before.focused){
  await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own new installed U required');const windows=E.BrowserWindow.getAllWindows();if(windows.length!==1)throw Error('One own newly launched installed window required');windows[0].show();E.app.focus({steal:false});windows[0].focus();windows[0].webContents.focus();return true})()`);record.requested=true;
  await app.waitFor('document.hasFocus()&&document.visibilityState==="visible"',4000);
 }
 record.after=await app.evaluate('({focused:document.hasFocus(),visibility:document.visibilityState})');assert(record.after.focused&&record.after.visibility==='visible');
}
