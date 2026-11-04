import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,chmod,mkdir,rm,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {copyFrozenInput,checkFrozenBrowserRuntime} from './frozen-inputs.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('preserves executable permissions and explicit frozen repair modes, and never overwrites an existing destination',async t=>{
  const root=await mkdtemp(join(tmpdir(),'willyou-m12-frozen-copy-'));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source'),destination=join(root,'copied/native');await writeFile(source,'synthetic native bytes',{mode:0o755});
  const hash=sha(await readFile(source));assert.deepEqual(await copyFrozenInput({source,destination,sha256:hash}),{sha256:hash,mode:0o755});assert.equal((await stat(destination)).mode&0o777,0o755);
  await chmod(source,0o644);const repair=join(root,'repair');await copyFrozenInput({source,destination:repair,sha256:hash,mode:0o755});assert.equal((await stat(repair)).mode&0o777,0o755);
  await assert.rejects(copyFrozenInput({source,destination,sha256:hash}),{code:'EEXIST'});assert.equal(await readFile(destination,'utf8'),'synthetic native bytes');
  await assert.rejects(copyFrozenInput({source,destination:join(root,'bad'),sha256:'0'.repeat(64)}),/Source differs/);const link=join(root,'link');await symlink(source,link);await assert.rejects(copyFrozenInput({source:link,destination:join(root,'linked'),sha256:hash}),/regular file/);
});
test('rejects source recipes and lost executable modes before a native fixture is launched',async t=>{
  const root=await mkdtemp(join(tmpdir(),'willyou-m12-frozen-runtime-'));t.after(()=>rm(root,{recursive:true,force:true}));const helper=join(root,'agent-browser/arm64/agent-browser'),source=join(root,'agent-browser/SOURCE.json');await mkdir(join(root,'agent-browser/arm64'),{recursive:true});await mkdir(join(root,'native'));const bytes='synthetic executable input';
  for(const path of [helper,join(root,'native/willyou-app'),join(root,'native/willyou-process-identity')])await writeFile(path,bytes,{mode:0o755});
  await writeFile(source,JSON.stringify({schema:2,version:'test',build:{}}));await assert.rejects(checkFrozenBrowserRuntime({resources:root,arch:'arm64'}),/Built runtime SOURCE.files/);
  await writeFile(source,JSON.stringify({version:'test',files:[{arch:'arm64',path:'arm64/agent-browser',sha256:sha(bytes)}]}));assert.equal((await checkFrozenBrowserRuntime({resources:root,arch:'arm64'})).files.length,3);
  await chmod(join(root,'native/willyou-process-identity'),0o644);await assert.rejects(checkFrozenBrowserRuntime({resources:root,arch:'arm64'}),/executable permissions/);
});
