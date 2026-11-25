// E: owner-scoped filesystem contract sketch, no Electron, no real helper processes.
// Operates only a newly created private root. It proves contract predicates, not production disposal.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, lstatSync, existsSync, readdirSync, unlinkSync, rmdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
const root=mkdtempSync('/private/tmp/willyou-f36-ultra-final-cleanup-contract-');
const pageNames=['A','B','C','D'];
const locations=id=>{assert(pageNames.includes(id));return{sock:join(root,id+'-socket'),home:join(root,id+'-home')}};
function fixture(id){const {sock,home}=locations(id);mkdirSync(sock);mkdirSync(home);mkdirSync(join(home,'tmp'));writeFileSync(join(sock,id+'.version'),'fixed-version');}
for(const id of pageNames)fixture(id);
const checks=[];
function record(name,ok,detail){checks.push({name,ok:!!ok,detail});assert(ok,name);}
function kind(p){try{const s=lstatSync(p);return s.isSymbolicLink()?'symlink':s.isDirectory()?'directory':s.isFile()?'file':'other';}catch(e){if(e.code==='ENOENT')return 'absent';throw e;}}
function finalDispose(id,receipt){
 // Temporary close may be followed by prepare()'s already-initialized state and reconnect;
 // destructive cleanup is a distinct, terminal owner operation, conditioned on real settlement.
 if(!receipt.terminal||!receipt.queueSettled||!receipt.clientStopped||!['stopped','absent'].includes(receipt.daemonState)||!receipt.socketFilesRemoved||!receipt.proxySettled)return {state:'deferred',reason:'not-final-or-unconfirmed'};
 const {sock,home}=locations(id),version=join(sock,id+'.version'),tmp=join(home,'tmp');
 if(kind(sock)==='absent'&&kind(home)==='absent')return{state:'already-clean'};
 // The sketch admits only the exact observed residue shape; unexpected contents are not removed.
 if(kind(sock)!=='directory'||kind(home)!=='directory')return{state:'deferred',reason:'unexpected-owner-path'};
 if(readdirSync(sock).some(e=>e!==id+'.version')||readdirSync(home).some(e=>e!=='tmp')||!['file','absent'].includes(kind(version))||!['directory','absent'].includes(kind(tmp))||(kind(tmp)==='directory'&&readdirSync(tmp).length!==0))return{state:'deferred',reason:'unexpected-owned-contents'};
 if(kind(version)==='file')unlinkSync(version);if(kind(tmp)==='directory')rmdirSync(tmp);rmdirSync(sock);rmdirSync(home);return{state:'cleaned'};
}
const settled={terminal:true,queueSettled:true,clientStopped:true,daemonState:'stopped',socketFilesRemoved:true,proxySettled:true};
const a=locations('A'),b=locations('B'),c=locations('C'),d=locations('D');
for(const [label,over] of [['temporary-close',{terminal:false}],['pending-queue',{queueSettled:false}],['pending-proxy',{proxySettled:false}],['unknown-process',{daemonState:'unknown'}],['active-client',{clientStopped:false}]]){
 const x=finalDispose('A',{...settled,...over});record(label,x.state==='deferred'&&existsSync(join(a.sock,'A.version'))&&existsSync(join(a.home,'tmp')),x);
}
let x=finalDispose('A',settled);record('terminal-confirmed',x.state==='cleaned'&&!existsSync(a.sock)&&!existsSync(a.home),x);
x=finalDispose('A',settled);record('idempotent',x.state==='already-clean',x);
record('independent-page-B-untouched',existsSync(join(b.sock,'B.version'))&&existsSync(join(b.home,'tmp')),{});
writeFileSync(join(c.home,'unexpected.txt'),'fixed unrelated fixture');x=finalDispose('C',settled);record('unexpected-content-preserved',x.state==='deferred'&&existsSync(join(c.home,'unexpected.txt'))&&existsSync(join(c.sock,'C.version')),x);
// Defensive filesystem identity validation; no follow of links, only this fixture.
unlinkSync(join(d.sock,'D.version'));rmdirSync(d.sock);symlinkSync(b.sock,d.sock);x=finalDispose('D',settled);record('non-directory-owner-path-preserved',x.state==='deferred'&&kind(d.sock)==='symlink'&&existsSync(join(b.sock,'B.version')),x);
console.log(JSON.stringify({root,layer:'E filesystem contract sketch; no actual BrowserHelper or production patch',checks,summary:{pass:checks.length,fail:0},remainingFixtureNames:readdirSync(root)},null,2));
