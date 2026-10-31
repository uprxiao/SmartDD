import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {describeActivationIssues} from '../upgrade-impact-report';
import {canonicalJson,digest} from '../manifest';
import type {ActivationIssue} from '../activation-preflight';
import {runFixture} from './run-fixture';
let f:Awaited<ReturnType<typeof runFixture>>;
const connectionId='11111111-1111-4111-8111-111111111111';
beforeEach(async()=>{
 f=await runFixture(undefined,{application:true,allowedOperations:['zentao.read']});
 f.sqlite.prepare("INSERT INTO tasks(id,project_id,cwd,runner,title,first_message,created_at,updated_at) VALUES(?,'p1',?,'claude','原汇总会话','private-message-canary',1,1)").run(f.snapshot.taskId,f.root);
 f.sqlite.prepare("INSERT INTO application_connections(id,app_id,provider_id,name,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_ref,secret_revision,policy_revision,enabled,auth_state,health,created_at,updated_at) VALUES(?,'zentao','zentao','公开测试连接','private-configuration-canary',1,1,1,'{}','unknown','private-secret-ref-canary',1,1,1,'connected','healthy','now','now')").run(connectionId);
});
afterEach(()=>f?.cleanup());
const issue=():ActivationIssue=>({code:'CONNECTION_CONTRACT_UNVERIFIED',causeCode:'CONFIG_INCOMPATIBLE',packageHash:f.application!.packageHash,taskId:f.snapshot.taskId,connectionId});
describe('read-only public activation impact projection',()=>{
 it('names exact retained version/session/connection with original permissions without copying private fields or changing state',()=>{
  const before=f.sqlite.serialize(),input=Object.freeze([Object.freeze({...issue(),unexpectedPrivateField:'private-extra-canary'})]),hash=digest(canonicalJson(input)),[value]=describeActivationIssues(f.packageRegistry,input);
  expect(value).toMatchObject({...issue(),appId:'zentao',appName:'禅道',version:'1.0.0',taskTitle:'原汇总会话',connectionName:'公开测试连接',operations:['zentao.read'],scope:'connection',verified:true});
  expect(digest(canonicalJson(input))).toBe(hash);expect(f.sqlite.serialize()).toEqual(before);
  const publicText=JSON.stringify(value);for(const canary of ['private-message-canary','private-configuration-canary','private-secret-ref-canary','private-extra-canary',f.home,f.root])expect(publicText).not.toContain(canary);
 });
 it('uses exact historical allowed actions rather than granting all manifest permissions; default targets are a separate scope',()=>{
  const base={code:'RETAINED_PACKAGE_INCOMPATIBLE',packageHash:f.application!.packageHash};const [history,target]=describeActivationIssues(f.packageRegistry,[{...base,taskId:f.snapshot.taskId},base]);
  expect(history.operations).toEqual(['zentao.read']);expect(history.scope).toBe('package');expect(target.operations).toEqual(['zentao.read','zentao.write']);expect(target.taskTitle).toBeNull();const prospective=describeActivationIssues(f.packageRegistry,[base],[f.application!])[0];expect(prospective.target).toBe(true);expect(history.target).toBe(false);
 });
 it('keeps damaged historical scope explicitly unverified and never guesses actions from the current default',()=>{
  f.sqlite.prepare('UPDATE capability_session_snapshots SET snapshot_json=? WHERE task_id=?').run('{broken',f.snapshot.taskId);const before=f.sqlite.serialize(),[value]=describeActivationIssues(f.packageRegistry,[issue()]);
  expect(value).toMatchObject({version:'1.0.0',taskTitle:'原汇总会话',operations:null,verified:false});expect(f.sqlite.serialize()).toEqual(before);
 });
 it('retains deleted-task history and unknown package identities without inventing titles or versions',()=>{
  f.sqlite.prepare('DELETE FROM tasks WHERE id=?').run(f.snapshot.taskId);const [history,unknown]=describeActivationIssues(f.packageRegistry,[issue(),{...issue(),packageHash:'f'.repeat(64)}]);
  expect(history).toMatchObject({taskId:f.snapshot.taskId,taskTitle:null,version:'1.0.0',operations:['zentao.read'],verified:true});expect(unknown).toMatchObject({taskId:f.snapshot.taskId,version:null,operations:null,verified:false});
 });
 it('refuses to infer a connection action scope across application identity or for a missing connection',()=>{
  f.sqlite.prepare("UPDATE application_connections SET app_id='mail',provider_id='smtp' WHERE id=?").run(connectionId);const [cross,missing]=describeActivationIssues(f.packageRegistry,[issue(),{...issue(),connectionId:'missing'}]);
  expect(cross).toMatchObject({operations:null,verified:false});expect(missing).toMatchObject({connectionName:null,operations:null,verified:false});
 });
 it('projects current public labels without mutating the compatibility issue or its digest',()=>{
  const input=[issue()],hash=digest(canonicalJson(input));expect(describeActivationIssues(f.packageRegistry,input)[0].taskTitle).toBe('原汇总会话');
  f.sqlite.prepare("UPDATE tasks SET title='修改后的公开名称' WHERE id=?").run(f.snapshot.taskId);expect(describeActivationIssues(f.packageRegistry,input)[0].taskTitle).toBe('修改后的公开名称');expect(digest(canonicalJson(input))).toBe(hash);
 });
});
