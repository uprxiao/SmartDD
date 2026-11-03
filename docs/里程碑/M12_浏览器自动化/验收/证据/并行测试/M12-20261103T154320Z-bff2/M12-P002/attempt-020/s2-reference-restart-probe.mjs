// Cross-process reference identity regression. Reuses the existing S1 native
// service/CLI fixture, preserving its setup/cleanup; only scenario calls differ.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=process.argv[2];assert(root?.startsWith('/private/tmp/willyou-m12-s1-'));
const original=await readFile('scripts/browser/s1-service-probe.mjs','utf8'),begin=original.indexOf("  await cli(['--list']);"),end=original.indexOf('\n} catch(error)',begin);assert(begin>0&&end>begin,'Existing fixture template boundaries must match');
await mkdir(root,{recursive:false});await symlink(resolve('node_modules'),join(root,'node_modules'));
const first=`
  const created=await cli(['browser','tab','create','--url',result.ready.url]);if(created.raw.code!==0)throw Error('Create failed');result.pageId=created.parsed.data.pageId;
  for(let i=0;i<8;i++){const s=await cli(['browser','snapshot']);if(s.raw.code!==0)throw Error('Snapshot failed');result.savedRef=s.parsed.data.refs.find(r=>r.role==='button'&&r.name==='Action').ref;}
  result.phase='first';
`;
const second=`
  const previous=JSON.parse(await readFile(join(dirname(output),'first/result.json'),'utf8'));result.previous={pageId:previous.pageId,ref:previous.savedRef,hostPid:previous.hostPid,runId:previous.ready.runId};
  const created=await cli(['browser','tab','create','--url',result.ready.url]);if(created.raw.code!==0)throw Error('Create failed');result.pageId=created.parsed.data.pageId;
  const decode=ref=>/^(@k[0-9a-z]+)s(\\d+)e(\\d+)$/.exec(ref);const old=decode(previous.savedRef);if(!old)throw Error('Ref shape changed');
  for(let i=0;i<24;i++){const s=await cli(['browser','snapshot']);if(s.raw.code!==0)throw Error('Snapshot failed');result.freshRef=s.parsed.data.refs.find(r=>r.role==='button'&&r.name==='Action').ref;const fresh=decode(result.freshRef);if(!fresh)throw Error('Ref shape changed');if(Number(fresh[2])>=Number(old[2]))break;}
  result.oldClick=await cli(['browser','click','--element',previous.savedRef]);result.afterOld=await call({command:'observe'});
  result.freshClick=await cli(['browser','click','--element',result.freshRef]);result.afterFresh=await call({command:'observe'});result.phase='second';
`;
const run=promisify(execFile),phases={};
for(const [name,body] of [['first',first],['second',second]]){
 const path=join(root,name+'-probe.mjs');await writeFile(path,original.slice(0,begin)+body+original.slice(end));
 await run(process.execPath,['--check',path],{cwd:process.cwd(),timeout:10000});
 const report=await run(process.execPath,[path,join(root,name)],{cwd:process.cwd(),timeout:240000,maxBuffer:1024*1024});await writeFile(join(root,name+'-driver.log'),report.stdout+report.stderr);phases[name]=JSON.parse(await readFile(join(root,name,'result.json'),'utf8'));if(phases[name].failure)break;
}
const bytes=Buffer.from(original);await writeFile(join(root,'result.json'),JSON.stringify({at:new Date().toISOString(),sourceTemplateSha256:createHash('sha256').update(bytes).digest('hex'),boundary:'I: two actual separate Electron service hosts, fixed helper and native CLI; no model or real data',phases},null,2)+'\n');console.log(JSON.stringify({root,phases:Object.keys(phases)}));
