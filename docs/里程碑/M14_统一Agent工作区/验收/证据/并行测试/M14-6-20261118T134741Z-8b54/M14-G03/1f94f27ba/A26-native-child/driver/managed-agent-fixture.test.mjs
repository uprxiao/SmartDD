import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { managedClaudeRoot, stageManagedAgent } from './managed-agent-fixture.mjs';

const archive=JSON.parse(readFileSync(new URL('053-managed-source.json',import.meta.url),'utf8'));
const profileId=archive.parentBinding.profile_id;
function tempData(t) {
  const path=realpathSync(mkdtempSync(join(import.meta.dirname,'preflight-')));
  t.after(()=>rmSync(path,{recursive:true,force:true}));
  const userData=join(path,'runtime-fixture/data');
  mkdirSync(userData,{recursive:true,mode:0o700});
  return {path,userData};
}

test('new fixture derives the exact user settings root held by real 053, unlike the old project definition',()=>{
  assert.equal(managedClaudeRoot(archive.userData,profileId),archive.parentBinding.state_root);
  assert(archive.projectDefinitionPresent);
  assert(!archive.managedDefinitionPresent);
  assert(archive.originsMatchOriginalDb);
});

test('stages one explicit definition in the real-shaped managed user root without touching settings or the project',t=>{
  const {userData}=tempData(t);
  const fixture=stageManagedAgent(userData,profileId,'a26-test-scope');
  assert.equal(fixture.file,join(fixture.root,'agents/a26-test-scope.md'));
  const content=readFileSync(fixture.file,'utf8');
  assert.match(content,/^tools: AskUserQuestion$/m);
  assert.equal(fixture.sha256,createHash('sha256').update(content).digest('hex'));
  assert.equal(statSync(fixture.file).mode&0o777,0o600);
  assert.throws(()=>stageManagedAgent(userData,profileId,'a26-test-scope'),/EEXIST/);
});

test('rejects data outside private roots, foreign profile identity, and symlink paths',t=>{
  const {path,userData}=tempData(t);
  assert.throws(()=>stageManagedAgent('/private/tmp',profileId,'a26-test-scope'));
  assert.throws(()=>stageManagedAgent(userData,'external-settings','a26-test-scope'));
  const outside=join(path,'another-directory');
  mkdirSync(outside);
  symlinkSync(outside,join(userData,'agents'));
  assert.throws(()=>stageManagedAgent(userData,profileId,'a26-test-scope'),/cannot follow links/);
});
