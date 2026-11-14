import {readFileSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root='/private/tmp/willyou-m14-global-f3zh527k',repo='/Users/hx/projects/SmartDD';
const results=[],sources=[];
async function load(rel,replace){let text=readFileSync(repo+'/'+rel,'utf8');sources.push({path:rel,sha256:createHash('sha256').update(text).digest('hex')});if(replace)text=replace(text);const js=stripTypeScriptTypes(text,{mode:'transform'});return import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));}
async function test(id,fn){try{results.push({id,status:'passed',detail:await fn()});}catch(e){results.push({id,status:'failed',error:String(e.stack)});}console.log(id,results.at(-1).status);}
const {inspectDir,pathIdentity}=await load('src/main/core/projects/dir-status.ts');
const fixture=JSON.parse(readFileSync(root+'/storage-a1/svn-fixture.json'));
await test('C01-actual-source-SVN-and-path-alias',async()=>{
 const a=inspectDir(fixture.wc),b=inspectDir(fixture.wc+'/nested');assert.equal(a.vcs,'svn');assert.equal(b.vcs,'svn');assert(a.available);assert.equal(pathIdentity(fixture.wc),pathIdentity(fixture.alias));
 return {root:a,nested:b,alias: pathIdentity(fixture.alias),boundary:'Production directory inspection only; sparse logical size is not IO performance proof.'};
});
const {BrowserAccess}=await load('src/main/core/browser/access.ts',s=>s.replace("import {ApplicationError} from '@shared/applications';","class ApplicationError extends Error { constructor(code:string,message:string){super(message);this.name=code;} }"));
await test('C02-actual-browser-parent-child-and-run-revocation',async()=>{
 const audits=[];const tasks=new Map([['parent','p'],['child','p'],['foreign','other']]);const service=new BrowserAccess({taskProject:id=>tasks.get(id)??null,audit:e=>audits.push(e)});
 const parent=new AbortController(),child=new AbortController(),command=new AbortController();
 const p={runId:'p-run',taskId:'parent',projectId:'p',signal:parent.signal},c={runId:'c-run',taskId:'child',projectId:'p',signal:child.signal};service.track(p);service.track(c);
 assert(service.can('p-run','parent','write'));assert(!service.can('c-run','parent','write'));
 const pending=service.request(c,'parent','observe',command.signal);const req=service.snapshot().requests[0];service.respond(req.id,true);await pending;
 assert(service.can('c-run','parent','read'));assert(!service.can('c-run','parent','write'));assert(!service.can('c-run','foreign','read'));
 child.abort();assert(!service.can('c-run','parent','read'));assert.equal(service.snapshot().grants.length,0);
 const again=new AbortController();service.track({...c,runId:'c-run-2',signal:again.signal});assert(!service.can('c-run-2','parent','read'));assert.throws(()=>service.respond(req.id,true));service.dispose();
 return {audit:audits.map(x=>({result:x.result,source:x.source})),dependency_substitution:'ApplicationError class only; exact BrowserAccess logic transformed by Node TypeScript API; not Electron integration'};
});
await test('C03-actual-browser-pending-cancel-and-late-approval',async()=>{
 const audits=[];const service=new BrowserAccess({taskProject:()=> 'p',audit:e=>audits.push(e)});const run=new AbortController(),cmd=new AbortController();
 const p=service.request({runId:'r',taskId:'a',projectId:'p',signal:run.signal},'b','control',cmd.signal);const id=service.snapshot().requests[0].id;const rejected=assert.rejects(p);run.abort();await rejected;assert.throws(()=>service.respond(id,true));assert(!service.can('r','b','write'));service.dispose();return audits.map(x=>({result:x.result,source:x.source}));
});
writeFileSync(root+'/component-result.json',JSON.stringify({results,sources},null,2));
