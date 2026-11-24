import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {app,BrowserWindow} from 'electron';
import {BrowserService,type BrowserScope} from '@main/core/browser/service';

const root=process.env.WY_ROOT!;
assert.match(root,/^\/private\/tmp\/willyou-m15-open-integration\.[A-Za-z0-9]+$/);
const repo=process.env.WY_SOURCE!;
const load=createRequire(join(repo,'package.json'));
const Database=load('better-sqlite3');
const helper=process.env.WY_HELPER!;
const sha256=process.env.WY_HELPER_SHA!;
app.setPath('userData',join(root,'userdata'));
const project='project-fixture',task='task-fixture',run='run-fixture',ac=new AbortController();
const accepted=()=>({taskId:task,projectId:project,runId:run,operationId:randomUUID(),requestId:randomUUID(),signal:ac.signal,runSignal:ac.signal,assertActive:()=>ac.signal.throwIfAborted(),assertRetained:()=>ac.signal.throwIfAborted()}) satisfies BrowserScope;
const reports:{path:string;at:number}[]=[];
let release!:()=>void;
const slow=new Promise<void>(resolve=>{release=resolve;});
const server=createServer(async(req,res)=>{
  if(req.url==='/favicon.ico'){res.writeHead(404).end();return;}
  reports.push({path:req.url!,at:Date.now()});
  if(req.url?.startsWith('/held'))await slow;
  if(!res.destroyed)res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end('<main><h1 id="fixture-ready">report</h1></main>');
});
async function until<T>(read:()=>T,match:(value:T)=>boolean){
  const until=performance.now()+10000;
  do{const value=read();if(match(value))return value;await new Promise(resolve=>setTimeout(resolve,25));}while(performance.now()<until);
  throw Error('Required test state was not reached');
}
const summaries:Record<string,unknown>={};
let service:BrowserService|undefined, db:InstanceType<typeof Database>|undefined, owner:BrowserWindow|undefined;
try{
  await app.whenReady();
  owner=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  db=new Database(join(root,'fixture.sqlite'));
  db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL); CREATE TABLE tasks(id TEXT PRIMARY KEY,project_id TEXT,title TEXT,cwd TEXT); CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT);');
  db.exec(readFileSync(join(repo,'drizzle/0030_browser_operations.sql'),'utf8'));
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?)').run(task,project,'Fixture',root);
  db.prepare('INSERT INTO projects VALUES(?,?)').run(project,'Fixture');
  service=new BrowserService({sqlite:db,userData:app.getPath('userData'),window:()=>owner??null,promptPreloadPath:join(repo,'out/preload/browser-prompt.js'),helper:{executable:helper,sha256},taskProject:id=>id===task?project:null,taskDirectory:()=>root});
  const present:string[]=[];
  service.attachOpenPresentation((_scope,id)=>present.push(id));
  const begin=(scope:BrowserScope,args:Record<string,unknown>)=>service!.execute(scope,'tab open',args) as Promise<{pageId:string;url:string;phase:string;reused:boolean}>;
  const ready=(scope:BrowserScope)=>until(()=>service!.operations.receipt(scope.runId,scope.requestId) as {summary?:{phase?:string}},result=>result.summary?.phase==='ready');
  const left=accepted(),right=accepted();
  const req={url:base+'/held?month=11#same',presentation:'show'};
  const [a,b]=await Promise.all([begin(left,req),begin(right,req)]);
  assert.equal(a.pageId,b.pageId);
  assert.equal(a.phase,'loading');assert.equal(b.phase,'loading');assert.equal(b.reused,true);
  await until(()=>reports.filter(row=>row.path==='/held?month=11').length,n=>n===1);
  assert.equal(service.workspace.snapshot(task).tabs.length,1);
  assert.equal(service.workspace.snapshot(task).tabs[0].loading,true);
  assert.deepEqual(await begin(left,req),a);
  for(const conflict of [
    {...req,url:base+'/held?month=12#same'},
    {pageId:a.pageId,presentation:'show'},
    {...req,profileId:'other-fixture-identity'},
    {...req,intent:'new'},
    {...req,presentation:'background'}
  ])await assert.rejects(begin(left,conflict),error=>(error as {code?:string}).code==='REQUEST_CONFLICT');
  assert.equal(service.workspace.snapshot(task).tabs.length,1);
  assert.deepEqual(present,[a.pageId,a.pageId]);
  release();
  await Promise.all([ready(left),ready(right)]);
  assert.equal(reports.filter(row=>row.path==='/held?month=11').length,1);
  const rendered=service.pages.get(task,a.pageId);
  assert.equal(await rendered.contents.executeJavaScript('document.querySelector("#fixture-ready")?.textContent'),'report');
  const newScope=accepted();
  const explicit={url:base+'/explicit',intent:'new',presentation:'background'};
  const [first,replay]=await Promise.all([begin(newScope,explicit),begin(newScope,explicit)]);
  assert.equal(first.pageId,replay.pageId);
  await ready(newScope);
  const secondScope=accepted(),second=await begin(secondScope,explicit);
  await ready(secondScope);
  assert.notEqual(first.pageId,second.pageId);
  assert.equal(reports.filter(row=>row.path==='/explicit').length,2);
  assert.equal(service.workspace.snapshot(task).tabs.length,3);
  summaries.shared={a,b,attemptedConflicts:5,activeTabs:service.workspace.snapshot(task).tabs.length};
  summaries.explicit={first,replay,second};
  summaries.status='passed';
}catch(error){summaries.status='failed';summaries.error=(error as Error).stack;}
finally{
  release();ac.abort();await service?.dispose();owner?.destroy();db?.close();
  server.closeAllConnections();
  if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  writeFileSync(join(root,'result.json'),JSON.stringify({electron:process.versions.electron,reports,summaries},null,2));
  app.exit(summaries.status==='passed'?0:1);
}
