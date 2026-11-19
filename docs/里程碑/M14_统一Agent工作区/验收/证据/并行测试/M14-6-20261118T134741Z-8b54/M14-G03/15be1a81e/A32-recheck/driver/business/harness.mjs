import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { capability, manifest, marker } from './build.mjs';

const base='/private/tmp/willyou-m14-stage6.WRvdST';
const sha=val=>createHash('sha256').update(val).digest('hex');
export const businessFixture={appId:manifest.id,capability,marker,tool:'smartdd_p'+sha(capability).slice(0,16)+'_v1'};

export function seedBusiness({out,root,executable,asar,commit}){
  assert.match(root,/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-\d+\/runtime-[A-Za-z0-9]+$/);
  const config=join(base,'g03/prep-next/a32-recheck/business/seed.vitest.config.mts');
  const file=join(root,'seed-context.json'),log=join(out,'seed.log');
  writeFileSync(file,JSON.stringify({root,executable,asarSha:asar,commit}),{mode:0o600,flag:'wx'});
  try{
    const output=execFileSync(process.execPath,[join(base,'source/scripts/run-tests.mjs'),'--config',config],{
      cwd:join(base,'source'),timeout:45000,maxBuffer:256*1024,encoding:'utf8',
      env:{PATH:process.env.PATH,M14_A32_SEED_CONTEXT:file,TMPDIR:join(root,'data')},
    });
    writeFileSync(log,output,{mode:0o600});
  }catch(error){
    writeFileSync(log,String(error.stdout??'')+'\n'+String(error.stderr??''),{mode:0o600});
    throw Error('A32 credential-free plugin seed failed. See the private seed.log');
  }
  const witness=JSON.parse(readFileSync(join(root,'seed-witness.json'),'utf8'));
  assert.equal(witness.commit,commit);
  assert.equal(witness.asarSha,asar);
  assert.equal(witness.capability,capability);
  assert(witness.seedHasNoSecrets&&witness.seedHasNoConnections&&witness.seedHasNoEffects);
  return witness;
}

export function businessGate(data){
  const root=join(data,'plugin-data',manifest.id);
  assert(realpathSync(root)===root&&root.startsWith(data+'/'));
  const effect=join(root,'effect.json'),release=join(root,'release.json');
  function read(){
    if(!existsSync(effect))return null;
    assert.equal(realpathSync(effect),effect);
    const bytes=readFileSync(effect),file=JSON.parse(bytes.toString('utf8'));
    assert.equal(file.marker,marker);
    return {...file,sha256:sha(bytes)};
  }
  function allow(operationId){
    assert.equal(read()?.operationId,operationId);
    assert(!existsSync(release));
    writeFileSync(release,JSON.stringify({operationId}),{mode:0o600,flag:'wx'});
  }
  return {read,allow,root};
}
