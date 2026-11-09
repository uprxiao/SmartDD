// Evidence projection only: original judge body unchanged; reads original files,
// redirects only save() to this safe directory. No harness/App/OS probe imported.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const attempt of ['001','002']){
 const original='/private/tmp/willyou-m12-t132-App024-A-'+attempt;
 const source=await readFile(original+'/judge.mjs','utf8'),body=source.slice(source.indexOf('const r='));
 assert(body.startsWith('const r=')&&!body.includes('import '));
 let saved;const context={exitCode:0};
 await new AsyncFunction('assert','readFile','ROOT','sha','save','console','process',body)(assert,readFile,original,sha,async(name,value)=>{assert.equal(name,'judge.json');saved=value},{log(){}},context);
 assert(saved&&saved.status==='failed-or-partial'&&context.exitCode===1);
 await writeFile(root+'A'+attempt+'/judge.original.safe.json',JSON.stringify({...saved,projection:{originalJudgeSHA256:sha(source),unchangedJudgeBodySHA256:sha(body),readOriginalFilesOnly:true,onlySaveRedirected:true,originalRootNeverWritten:true}},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({attempt,status:saved.status,checks:saved.checks.length,passed:saved.checks.filter(x=>x.pass).length,failed:saved.checks.filter(x=>!x.pass).map(x=>x.id)}));
}
