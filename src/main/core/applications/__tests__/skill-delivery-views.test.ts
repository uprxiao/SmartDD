import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {DiscoveryCatalog} from '../discovery-catalog';
import {applicationSkillProjectionName} from '../application-skill-template';
import {cliFixture} from './cli-fixture';

let f:Awaited<ReturnType<typeof cliFixture>>;
beforeEach(async()=>{f=await cliFixture();});afterEach(async()=>{await f.cleanup();});
describe('M11 per-run Skill views preserve fixed sources and isolate native discovery identities',()=>{
 it('publishes CLI and fallback MCP views of the same immutable package in one HOME without collision',async()=>{
  const before=f.sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(f.snapshot.taskId),cli=f.projector.sourceSkills(f.snapshot,undefined,false,undefined,{mcp:true,cli:true}),mcp=f.projector.sourceSkills(f.snapshot,undefined,false,undefined,{mcp:true,cli:false}),first=cli.find(s=>s.appId==='mail')!,second=mcp.find(s=>s.appId==='mail')!;
  expect(first.sourceHash).toBe(second.sourceHash);expect(first.sourceResourceId).toBe(second.sourceResourceId);expect(first.path).not.toBe(second.path);expect(first.templateHash).toBe(second.templateHash);expect(first.parametersHash).not.toBe(second.parametersHash);expect(first.renderedHash).not.toBe(second.renderedHash);
  expect(first.files['SKILL.md'].toString()).toContain('willyou-app mail draft list');expect(first.files['SKILL.md'].toString()).not.toContain('MCP 工具 smartdd_mail_draft_list_v2');expect(second.files['SKILL.md'].toString()).toContain('MCP 工具 smartdd_mail_draft_list_v2');
  const catalog=new DiscoveryCatalog(f.store,f.home,f.reader);await catalog.publish(cli,{requestedOnly:true});const published=await catalog.publish(mcp,{requestedOnly:true});
  for(const source of [first,second]){const entry=published.entries.find(e=>e.path===source.path)!;expect(entry).toBeDefined();expect(readFileSync(source.path).equals(source.files['SKILL.md'])).toBe(true);expect(()=>catalog.verifyReference(f.store.get(entry.resourceId),f.snapshot)).not.toThrow();}
  expect(f.sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(f.snapshot.taskId)).toEqual(before);
 });
 it('gives identical effective CLI invocations identical bytes and identities regardless of inactive MCP availability',()=>{
  const source=(mcp:boolean)=>f.projector.sourceSkills(f.snapshot,undefined,false,undefined,{mcp,cli:true}).find(s=>s.appId==='mail')!,first=source(true),second=source(false);
  expect(first.nativeName).toBe(second.nativeName);expect(first.delivery).toEqual(second.delivery);expect(first.parametersHash).toBe(second.parametersHash);expect(first.renderedHash).toBe(second.renderedHash);expect(first.files).toEqual(second.files);
 });
 it('does not publish a forged invocation view even if its name and delivery parameters are internally consistent',async()=>{
  const source=f.projector.sourceSkills(f.snapshot,undefined,false,undefined,{mcp:true,cli:true}).find(s=>s.appId==='mail')!,changed=structuredClone(source.delivery!);changed.available={cli:false,mcp:true};const pkg=f.applications.builtin.assertTrusted(f.snapshot.packages[0].packageHash),name=applicationSkillProjectionName(pkg.manifest,'work-assistant',pkg.packageHash,changed),catalog=new DiscoveryCatalog(f.store,f.home,f.reader);
  await expect(catalog.publish([{...source,nativeName:name,delivery:changed}],{requestedOnly:true})).rejects.toMatchObject({code:'HASH_MISMATCH'});expect(f.sqlite.prepare("SELECT count(*) n FROM capability_resources WHERE kind='agent-projection' AND state='ready'").get()).toEqual({n:0});expect(existsSync(join(f.home,'.agents/skills',name,'SKILL.md'))).toBe(false);
 });
});
