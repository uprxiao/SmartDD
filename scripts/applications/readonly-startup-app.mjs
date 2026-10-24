// T70 actual packaged startup with OS-enforced private directory permissions.
// Probe mode only reports the expected startup error instead of a native dialog.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,chmod,stat,open,readdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {openElectron} from '../lib/electron-harness.mjs';
import {installAppFocusGuard} from '../lib/app-focus-guard.mjs';

const executable=process.env.WILLYOU_ACCEPTANCE_APP,expected=process.env.WILLYOU_ACCEPTANCE_ASAR_SHA;
assert(executable?.startsWith('/private/tmp/willyou-m10-')&&expected);
const root=await mkdtemp('/private/tmp/willyou-m10-readonly-startup-'),home=join(root,'home 中文 空格');await mkdir(home);
const asar=join(resolve(dirname(executable),'../..'),'Contents/Resources/app.asar'),hash=b=>createHash('sha256').update(b).digest('hex');assert.equal(hash(await readFile(asar)),expected);
const result={root,startedAt:new Date().toISOString(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:true,driverSha256:hash(await readFile(new URL(import.meta.url))),asar:expected,layer:'I: actual packaged startup and OS permission denial; SMARTDD_PROBE suppresses error dialog only; no GUI/CLI/system approval acceptance',checks:[],appPids:[],faultPids:[]};
const check=name=>result.checks.push({name,at:new Date().toISOString(),passed:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['PATH','TMPDIR','LANG','LC_ALL'].includes(k)));Object.assign(env,{HOME:home,ZDOTDIR:home,HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',ALL_PROXY:'http://127.0.0.1:1',NO_PROXY:'localhost,127.0.0.1'});
for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);
let app,locked=[];
async function start(userData){app=await openElectron({executable,userData,env,inspectMain:true});installAppFocusGuard(app,result);result.appPids.push(app.processId);await app.evaluate("document.title='A · M10 · private read-only startup fixture';true");}
async function quit(label){await writeFile(join(root,label+'.log'),app.logs());await app.mainEvaluate("(()=>{setTimeout(()=>process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.quit(),30);return true})()");assert.equal((await app.waitForExit()).code,0);await app.close();app=undefined;}
async function readOnly(file,mode){const before=(await stat(file)).mode&0o777;locked.push([file,before]);await chmod(file,mode);}
async function unlock(){for(const [file,mode] of locked.reverse())await chmod(file,mode);locked=[];}
async function denyWrite(path){await assert.rejects(async()=>{const f=await open(path,'a');await f.close();},e=>e.code==='EACCES'||e.code==='EPERM');}
async function fault(userData,label){
 const child=spawn(executable,[],{env:{...env,SMARTDD_USER_DATA:userData,SMARTDD_PROBE:'1'},stdio:['ignore','pipe','pipe']});result.faultPids.push(child.pid);let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');},15000);
 const exit=await new Promise((r,j)=>{child.once('error',j);child.once('exit',(code,signal)=>r({code,signal}));});clearTimeout(timer);
 await writeFile(join(root,label+'.stdout'),stdout);await writeFile(join(root,label+'.stderr'),stderr);assert(!timedOut,'Readonly startup must fail within its bounded wait');assert.equal(exit.code,1);assert.match(stderr,/EACCES|EPERM|permission denied|readonly|read-only/i);return{userData,label,...exit,stderr,probeMode:true};
}
async function databaseFiles(dir){const found=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())found.push(...await databaseFiles(p));else if(e.name==='smartdd.db')found.push(p);}return found;}
async function inventory(expectedDbs){const files=(await databaseFiles(root)).sort(),backups=[];for(const file of files){if(expectedDbs.includes(file))continue;assert(expectedDbs.some(db=>file.startsWith(join(dirname(db),'backups/m10')+'/')),'Unexpected fallback business DB: '+file);const receipt=JSON.parse(await readFile(join(dirname(file),'operation.json'),'utf8'));assert.equal(receipt.schema,1);assert.equal(receipt.state,'verified');assert.equal(receipt.file,'smartdd.db');assert.equal(hash(await readFile(file)),receipt.sha256);backups.push({file,sha256:receipt.sha256,operationId:receipt.operationId});}assert(expectedDbs.every(db=>files.includes(db)));return{business:expectedDbs,backups};}
try{
 assert.notEqual(process.getuid(),0,'OS permission test cannot run as root');
 const existing=join(root,'已有数据 只读目录');await start(existing);const project=await app.invoke('projects.create',{name:'T70 原库保留 canary',aliases:[],description:'Private persisted permission canary',rulesPath:null});result.originalProject=project;await quit('initial');
 const db=join(existing,'smartdd.db'),identity=await stat(db),bytes=hash(await readFile(db));result.before={db,ino:identity.ino,dev:identity.dev,sha256:bytes};const originalInventory=await inventory([db]);result.originalInventory=originalInventory;
 await readOnly(db,0o400);await readOnly(existing,0o500);await denyWrite(db);await denyWrite(join(existing,'must-not-be-created'));check('Existing business database and U reject actual OS writes under this non-root user');
 result.existingFailure=await fault(existing,'existing-denied');assert.equal(hash(await readFile(db)),bytes);assert.equal((await stat(db)).ino,identity.ino);assert.deepEqual(await inventory([db]),originalInventory);check('Actual packaged startup exits with permission error; original DB bytes/inode retained and no fallback business DB created');
 await unlock();await start(existing);assert.deepEqual(await app.invoke('projects.get',project.id),project);const after=await app.invoke('projects.create',{name:'T70 权限恢复写入',aliases:[],description:'Recovered same U',rulesPath:null});assert.notEqual(after.id,project.id);assert.equal((await stat(db)).ino,identity.ino);assert.equal((await stat(db)).dev,identity.dev);await quit('existing-recovered');check('After original OS permissions restore, same packaged host opens original project and writes another project in the same DB inode');
 const fresh=join(root,'全新目录 只读');await mkdir(fresh);await readOnly(fresh,0o500);await denyWrite(join(fresh,'must-not-be-created'));result.freshFailure=await fault(fresh,'fresh-denied');assert.deepEqual(await readdir(fresh),[]);assert.deepEqual(await inventory([db]),originalInventory);check('Fresh read-only U fails explicitly before creating DB/resources and does not switch to another business database');
 await unlock();await start(fresh);assert.deepEqual(await app.invoke('projects.list'),[]);const created=await app.invoke('projects.create',{name:'T70 首装权限恢复',aliases:[],description:'Fresh same U recovery',rulesPath:null});assert(created.id);await quit('fresh-recovered');result.finalInventory=await inventory([db,join(fresh,'smartdd.db')]);check('Fresh U retry after permission restoration initializes exactly its requested business DB and creates a real project');
 assert.equal(hash(await readFile(asar)),expected);check('Original App ASAR unchanged; zero UI input, no copied credentials or daily data');result.status='passed-partial';result.remaining=['T70 actual CLI/Claude/system UI/install/uninstall and full original case remain separate','Permission error is real OS enforcement; probe mode skips native error dialog only, not a normal GUI startup pass'];
}catch(error){result.status='failed';result.error=String(error);result.stack=error.stack;process.exitCode=1;}
finally{await unlock();if(app){await writeFile(join(root,'failure.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,error:result.error,result:join(root,'result.json')}));}
