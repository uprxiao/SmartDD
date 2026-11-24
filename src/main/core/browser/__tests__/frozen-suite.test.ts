import {mkdtemp,mkdir,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {browserDigest} from '../artifacts';
import {readFrozenSuite,writeFrozenSuite} from '../frozen-suite';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'willyou-frozen-suite-'));
  roots.push(root);
  const bundle=join(root,'bundle');
  await mkdir(bundle);
  const suite='export const handlers = {};';
  const cases=JSON.stringify({cases:[{id:'C1'}]});
  const map=JSON.stringify({
    suiteFile:'suite.mjs',suiteSha256:browserDigest(suite),casesSha256:browserDigest(cases),
    cases:[{id:'C1',handler:'testHandler',status:'implemented'}],
  });
  const entries=[];
  for(const [file,value] of [['suite.mjs',suite],['cases.json',cases],['script-map.json',map]]){
    await writeFile(join(bundle,file),value);
    entries.push({file,sha256:browserDigest(value)});
  }
  await writeFile(join(bundle,'extra.mjs'),'throw new Error("unreviewed data");');
  const sources:unknown[]=[];
  const revision=browserDigest(JSON.stringify({entries,sources}));
  await writeFile(join(bundle,'manifest.json'),JSON.stringify({schema:'source-ui-baseline-v2',revision,entries,sources}));
  return{root,bundle,suite,input:{bundle:'bundle',revision,cases:['C1']}};
}

describe('frozen source-driven UI suite ingress',()=>{
  it('copies only the approved bytes and keeps the original case identity',async()=>{
    const f=await fixture();
    const frozen=await readFrozenSuite(f.root,f.input);
    await writeFile(join(f.bundle,'suite.mjs'),'changed after approval');
    const work=join(f.root,'work');
    await writeFrozenSuite(work,frozen.files);
    expect(frozen.selected).toEqual([{id:'C1',handler:'testHandler',operations:[]}]);
    expect(await readFile(join(work,'suite.mjs'),'utf8')).toBe(f.suite);
    await expect(readFile(join(work,'extra.mjs'))).rejects.toMatchObject({code:'ENOENT'});
    await expect(readFrozenSuite(f.root,f.input)).rejects.toMatchObject({code:'INTENT_STALE'});
  });
  it('rejects an identical file reached through a symbolic link',async()=>{
    const f=await fixture();
    const linkTarget=join(f.root,'other.mjs');
    await writeFile(linkTarget,f.suite);
    await rm(join(f.bundle,'suite.mjs'));
    await symlink(linkTarget,join(f.bundle,'suite.mjs'));
    await expect(readFrozenSuite(f.root,f.input)).rejects.toMatchObject({code:'SCOPE_DENIED'});
  });
});
