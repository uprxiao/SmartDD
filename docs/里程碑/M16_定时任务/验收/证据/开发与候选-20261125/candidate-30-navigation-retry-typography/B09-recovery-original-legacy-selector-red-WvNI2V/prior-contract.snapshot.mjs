import assert from 'node:assert/strict';import {readFile,realpath,readdir,lstat,cp} from 'node:fs/promises';import {join,basename} from 'node:path';import {execFileSync} from 'node:child_process';import {support,digest} from '../guards-c30-final.mjs';
const dir=join(support,'c30-recovery-filetype-resume'),archive=join(dir,'prior-actual-failure-wfDkw4');
export const priorRoot='/private/tmp/willyou-m16-b09-c30-filetype-recovery-pair-wfDkw4',priorSha='53a19cf3150c8d8a4b07e55d351e3039d4d5086c39320a76cca8e674814764f4';
export async function verifyResumePrior(args){
 assert.deepEqual(args,[priorRoot,priorSha]);assert.equal(await realpath(archive),archive);
 const manifest=JSON.parse(await readFile(join(dir,'prior-manifest.json'),'utf8'));assert.equal(manifest.actualRoot,priorRoot);assert.equal(manifest.rawReportSha,priorSha);
 assert.deepEqual((await readdir(archive)).sort(),Object.keys(manifest.files).sort());for(const [n,sha] of Object.entries(manifest.files)){const p=join(archive,n);assert.equal(n,basename(n));assert.equal(await realpath(p),p);const z=await lstat(p);assert(z.isFile()&&!z.isSymbolicLink());assert.equal(await digest(p),sha);}
 const reportPath=join(archive,'result.json');assert.equal(await digest(reportPath),priorSha);const previous=JSON.parse(await readFile(reportPath,'utf8'));assert.equal(previous.root,priorRoot);assert.equal(previous.status,'failed-or-partial');assert(previous.error.includes('driver.mjs:184:435')&&previous.error.includes('Electron test condition timed out'));assert.equal(previous.captures.length,0);assert.equal(previous.originalRows.length,0);assert.deepEqual(previous.selectedSizes,[[1440,900],[1920,1080]]);
 assert.equal(previous.sides.length,1);const side=previous.sides[0],isolated=side.isolated,own=isolated.own,db=join(own,'data/smartdd.db'),journal=join(own,'data/browser/import-journal');
 assert.equal(side.side,'old-clean');assert.equal(own,manifest.priorOldSideRoot);assert(/^\/private\/tmp\/willyou-m16-b09-c30-final-side-[A-Za-z0-9]+$/.test(own));assert.equal(isolated.home,join(own,'home'));assert.equal(isolated.cliHome,join(own,'cli-home'));assert.equal(isolated.userData,join(own,'data'));
 for(const p of [own,isolated.home,join(isolated.home,'.config'),isolated.cliHome,join(isolated.cliHome,'.codex'),join(isolated.cliHome,'.claude'),isolated.userData,join(own,'tmp'),journal]){assert.equal(await realpath(p),p);const z=await lstat(p);assert(z.isDirectory()&&!z.isSymbolicLink());}
 assert.equal(await realpath(db),db);assert((await lstat(db)).isFile()&&!(await lstat(db)).isSymbolicLink());assert(!(await readdir(isolated.userData)).includes('smartdd.db-wal'));
 assert.equal(previous.launches.length,2);assert(previous.launches.every(l=>l.expected==='697bb2d273a743c22a2d2c2ebc3c509b0fcee3f9c4bbeeb34146c590b2d9afe2'&&l.exit?.code===0&&l.exit.signal===null&&l.finalCounts.secretCount===0&&l.finalCounts.providerSecretCount===0));
 const last=previous.launches.at(-1);assert.equal(last.dbSha,manifest.priorLastClosedDbSha);assert.equal(await digest(db),last.dbSha);assert.equal(last.exit.pid,manifest.priorLastNormalExit.pid);
 const tasks=side.tasks;assert.equal(tasks.length,8);assert.equal(manifest.savedLogicalTabs.length,8);assert.equal(new Set(tasks.map(t=>t.page.profile)).size,8);assert.deepEqual((await readdir(journal)).sort(),tasks.map(t=>t.page.profile+'.bin').sort());
 for(const task of tasks){assert(task.bootstrap.record.importState==='ready'&&task.bootstrap.record.profile.source===null&&task.bootstrap.observed.marker);assert.equal(task.url,task.page.url);assert(task.url.startsWith(manifest.actualPageOrigin+'/page?combo='));assert.equal(await realpath(task.dir),task.dir);assert.equal(task.dir,join(own,'project-'+task.key));assert(!task.fault.released);const z=await lstat(task.fault.path);assert.equal(task.fault.path,join(journal,task.page.profile+'.bin'));assert.equal(await realpath(task.fault.path),task.fault.path);assert(z.isDirectory()&&!z.isSymbolicLink()&&z.ino===task.fault.ino&&z.mode===task.fault.mode&&!(await readdir(task.fault.path)).length);}
 const current=JSON.parse(execFileSync('python3',['-c',`import json,sqlite3,sys,hashlib
c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro&immutable=1",uri=True)
out=[]
for k in json.loads(sys.argv[2]):
 row=c.execute("select value from app_settings where key=?",("browserWorkspace.v1:"+k,)).fetchone()
 assert row
 s=json.loads(row[0]);out.append({"taskId":k,"savedStateSha":hashlib.sha256(row[0].encode()).hexdigest(),"state":s})
print(json.dumps(out))`,db,JSON.stringify(tasks.map(t=>t.taskId))],{encoding:'utf8'}));
 for(const task of tasks){const x=current.find(x=>x.taskId===task.taskId),m=manifest.savedLogicalTabs.find(x=>x.taskId===task.taskId);assert(x&&m&&x.savedStateSha===m.savedStateSha&&m.faultIno===task.fault.ino&&m.faultMode===task.fault.mode);assert.equal(x.state.activeId,task.page.id);assert.equal(x.state.tabs.length,1);assert.equal(x.state.tabs[0].id,task.page.id);assert.equal(x.state.tabs[0].profileId,task.page.profile);assert.equal(x.state.tabs[0].url,task.url);assert.deepEqual(x.state.closed,[]);}
 const port=Number(new URL(manifest.actualPageOrigin).port);assert.equal(manifest.actualPageOrigin,'http://127.0.0.1:63156');assert.equal(port,63156);assert.equal(manifest.actualProviderOrigin,'http://127.0.0.1:3425');
 return {previous,manifest,side,current,archive,reportPath,resume:{pid:last.exit.pid,dbSha:last.dbSha},port};
}
export async function retainFailure(verified,root){
 assert(/^\/private\/tmp\/willyou-m16-b09-c30-filetype-recovery-pair-[A-Za-z0-9]+$/.test(root)&&root!==priorRoot&&await realpath(root)===root);
 const raw=join(root,'prior-result.exact.json'),screen=join(root,'prior-failed-shell.exact.png');await cp(verified.reportPath,raw,{force:false,errorOnExist:true});assert.equal(await digest(raw),priorSha);await cp(join(verified.archive,'failed-shell.png'),screen,{force:false,errorOnExist:true});assert.equal(await digest(screen),verified.manifest.actualFailure.failedShellSha);await cp(join(dir,'prior-manifest.json'),join(root,'prior-manifest.exact.json'),{force:false,errorOnExist:true});
 return {raw,screen,rawReportSha:priorSha,failedImageSha:verified.manifest.actualFailure.failedShellSha,priorActualRoot:priorRoot,priorClosedDbSha:verified.resume.dbSha,priorOldState:verified.manifest.savedLogicalTabs,priorNormalExit:verified.manifest.priorLastNormalExit};
}
