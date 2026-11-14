import { NativeFileBroker, parseGitStatus } from './actual-files.cjs';
import { readFileSync, writeFileSync, statSync, realpathSync, readdirSync, readlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';
const output='/private/tmp/willyou-m14-git-probe';
const fixture=JSON.parse(readFileSync(join(output,'result.json'),'utf8')).fixture;
const hash=b=>createHash('sha256').update(b).digest('hex');
function snapshot(dir){
 const files={};
 function visit(at){for(const e of readdirSync(at,{withFileTypes:true})){
   const p=join(at,e.name),key=relative(dir,p);
   if(e.isDirectory())visit(p);else files[key]=e.isSymbolicLink()?{link:readlinkSync(p)}:{sha256:hash(readFileSync(p))};
 }}
 visit(dir);return files;
}
const results=[];
const broker=new NativeFileBroker(join(output,'file-broker'));
const targets=[['J13','dirty-parent',['tracked.txt','blob.bin','delete.txt','renamed.txt','未跟踪 空格.txt']],['J14','dirty-child',['tracked.txt']]];
const before=snapshot(fixture);
try{
 for(const [id,name,expected] of targets){
  const path=realpathSync(join(fixture,name)),s=statSync(path,{bigint:true});
  const raw=await broker.request({operation:'git-status',root:{path,identity:{device:String(s.dev),inode:String(s.ino)}}});
  assert.equal(raw.state,'ready');
  const rows=parseGitStatus(raw);
  for(const file of expected)assert(rows.some(r=>r.relativePath===file),`${name} missing ${file}`);
  if(name==='dirty-child')assert.equal(rows.length,1);
  results.push({id,status:'passed',name,raw,rows});
 }
 assert.deepEqual(snapshot(fixture),before);
 assert.equal(broker.activeProcesses,0);
 results.push({id:'J15',status:'passed',unchangedFixtureFilesAndGitMetadata:true,activeProcesses:broker.activeProcesses});
}catch(e){results.push({id:'broker-failure',status:'failed',error:String(e.stack||e)});}
finally{broker.dispose();}
writeFileSync(join(output,'broker-result.json'),JSON.stringify({
 kind:'actual-SmartDD-NativeFileBroker-and-parser-not-App',fixture,
 helperSha256:hash(readFileSync(join(output,'file-broker'))),
 bundleSha256:hash(readFileSync(join(output,'actual-files.cjs'))),results,
 passed:results.filter(x=>x.status==='passed').length,
},null,2)+'\n');
console.log(JSON.stringify(results.map(({id,status})=>({id,status}))));
process.exitCode=results.some(x=>x.status==='failed')?1:0;
