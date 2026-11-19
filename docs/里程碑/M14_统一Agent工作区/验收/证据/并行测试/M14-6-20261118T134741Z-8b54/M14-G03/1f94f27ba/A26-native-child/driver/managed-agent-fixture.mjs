import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const privateData=/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/(?:attempt-\d+|prep-next\/a26-native-composition\/preflight-[A-Za-z0-9]+)\/runtime-[A-Za-z0-9]+\/data$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
export function managedClaudeRoot(userData, profileId) {
  assert.match(userData,privateData);
  assert.equal(realpathSync(userData),userData);
  assert.match(profileId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  return join(userData,'agents','claude',sha(profileId).slice(0,32));
}

export function stageManagedAgent(userData,profileId,nativeType) {
  const root=managedClaudeRoot(userData,profileId);
  assert.match(nativeType,/^a26-[a-z0-9-]+$/);
  for (const folder of [join(userData,'agents'),join(userData,'agents','claude'),root,join(root,'agents')]) {
    const old=lstatSync(folder,{throwIfNoEntry:false});
    if (old) assert(old.isDirectory()&&!old.isSymbolicLink(),'managed test path cannot follow links');
    else mkdirSync(folder,{mode:0o700});
    assert.equal(realpathSync(folder),folder);
  }
  const definition=[
    '---','name: '+nativeType,'description: Ask one literal question in the isolated A26 fixture',
    'tools: AskUserQuestion','model: inherit','---',
    'Ask only the provided synthetic question. Do not run commands or touch files.',
  ].join('\n')+'\n';
  const file=join(root,'agents',nativeType+'.md');
  writeFileSync(file,definition,{mode:0o600,flag:'wx'});
  assert.equal(realpathSync(file),file);
  return {root,file,sha256:sha(definition),profileId,declaredTools:['AskUserQuestion']};
}
