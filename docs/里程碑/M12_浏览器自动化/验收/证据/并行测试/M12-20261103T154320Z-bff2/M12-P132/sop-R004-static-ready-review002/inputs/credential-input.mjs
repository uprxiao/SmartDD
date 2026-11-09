// Called only after Root's payload/lease gate. Never read/hash/output auth contents.
import assert from 'node:assert/strict';
import {lstat,copyFile,mkdir,chmod,writeFile,realpath} from 'node:fs/promises';
import {ROOT} from './io.mjs';
const source = '/private/tmp/willyou-m12-t120-t125-app022-retest-001/runtime-001/codex/auth.json';
export async function installOwnedAuthentication({stateRoot,projects}) {
  assert.equal(stateRoot,ROOT+'/runtime-001/codex'); assert.equal(await realpath(ROOT),ROOT);
  assert(projects.length===2&&projects.every(path=>path.startsWith(ROOT+'/runtime-001/projects/')));
  const stat=await lstat(source);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0,'Owned T120 auth must already exist; no fallback/login/daily source');
  await mkdir(stateRoot,{mode:0o700});await copyFile(source,stateRoot+'/auth.json');await chmod(stateRoot+'/auth.json',0o600);
  const config='model="gpt-6.1-sol"\nmodel_provider="openai"\nsandbox_mode="workspace-write"\napproval_policy="on-request"\nnotify=[]\n[analytics]\nenabled=false\n[feedback]\nenabled=false\n'+projects.map(path=>'[projects.'+JSON.stringify(path)+']\ntrust_level="trusted"\n').join('');
  await writeFile(stateRoot+'/config.toml',config,{flag:'wx',mode:0o600});
  return {sourceCategory:'same-round-owned-T120-CODEX_HOME-auth-only',destinationCategory:'new-private-group-CODEX_HOME',copiedAuthOnly:true,authReadOrPrintedOrHashed:false,oldConfigSkillCatalogEnvHistoryCopied:false,provider:'openai',model:'gpt-6.1-sol',sandbox:'workspace-write',approval:'on-request'};
}
