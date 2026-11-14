import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach,beforeEach,expect,it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { CapabilityRegistryService, type CapabilityScanContext } from './capability-registry';
import { SkillProjectionService, type SkillProjectionInput } from './skill-projection';
let root:string,sqlite:Database.Database,registry:CapabilityRegistryService,projection:SkillProjectionService,contexts:CapabilityScanContext[],input:SkillProjectionInput;
const file=(path:string,content:string)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content);return path;};
const skill=(name:string,project=false)=>file(join(root,project?'project':'home', '.claude/skills',name,'SKILL.md'),`---\nname: ${name}\ndescription: public fixture\n---\nVERSION1`);
const git=(cwd:string,...args:string[])=>{const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',env:{PATH:process.env.PATH,HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
beforeEach(()=>{root=realpathSync(mkdtempSync(join(tmpdir(),'m13-project-')));sqlite=new Database(':memory:');runBundledMigrations(sqlite);const db=drizzle(sqlite,{schema});mkdirSync(join(root,'project'),{recursive:true});contexts=[{runner:'claude',home:join(root,'home'),stateRoot:join(root,'home/.claude'),cwd:join(root,'project'),projectRoot:join(root,'project'),path:''}];registry=new CapabilityRegistryService(db,()=>contexts,()=>Date.now(),{revoke:id=>projection.revoke(id),afterScan:()=>projection.reconcileSources()});projection=new SkillProjectionService(db,registry);input={runner:'codex',home:join(root,'home'),stateRoot:join(root,'home/.codex'),cwd:join(root,'project'),runRoot:join(root,'runs/a'),nativeLogin:false};});
afterEach(()=>{sqlite.close();rmSync(root,{recursive:true,force:true});});
it('projects a user Skill into Codex without copying and cancellation removes only its owned link',()=>{
  const source=skill('echo');registry.scan();const id=registry.adoptAll().items[0].id;
  expect(projection.prepare(input)).toMatchObject({configured:[id],issues:[]});const target=join(root,'home/.agents/skills/echo/SKILL.md');expect(realpathSync(target)).toBe(realpathSync(source));
  writeFileSync(source,readFileSync(source,'utf8').replace('VERSION1','VERSION2'));expect(readFileSync(target,'utf8')).toContain('VERSION2');
  registry.setManaged(id,false);expect(existsSync(dirname(target))).toBe(false);expect(readFileSync(source,'utf8')).toContain('VERSION2');
});
it('cleans dangling owned links at next scan and keeps the managed source as missing',()=>{
  const source=skill('gone');registry.scan();registry.adoptAll();projection.prepare(input);rmSync(dirname(source),{recursive:true});
  expect(registry.scan().items[0].status).toBe('missing');expect(existsSync(join(root,'home/.agents/skills/gone'))).toBe(false);
});
it('removes an old persistent target when the source CLI disables its Skill, retaining its original file and config',()=>{
  const source=file(join(root,'home/.agents/skills/from-codex/SKILL.md'),'---\nname: from-codex\ndescription: source\n---\n');
  contexts=[{...contexts[0],runner:'codex',stateRoot:join(root,'home/.codex')}];registry.scan();registry.adoptAll();const targetRoot=join(root,'managed-claude');
  expect(projection.prepare({...input,runner:'claude',stateRoot:targetRoot}).configured).toHaveLength(1);expect(existsSync(join(targetRoot,'skills/from-codex/SKILL.md'))).toBe(true);
  const text='[skills]\nconfig=[{path='+JSON.stringify(dirname(source))+',enabled=false}]\n';const config=file(join(root,'home/.codex/config.toml'),text);
  expect(registry.scan().items[0]).toMatchObject({managed:true,status:'invalid',issues:expect.arrayContaining(['source_disabled'])});expect(existsSync(join(targetRoot,'skills/from-codex'))).toBe(false);
  expect(readFileSync(config,'utf8')).toBe(text);expect(readFileSync(source,'utf8')).toContain('description: source');
});
it('does not overwrite or delete a replaced user target, even after cancellation',()=>{
  skill('echo');registry.scan();const id=registry.adoptAll().items[0].id;projection.prepare(input);const target=join(root,'home/.agents/skills/echo');rmSync(target);file(join(target,'USER.md'),'MY_DATA');
  expect(()=>registry.setManaged(id,false)).toThrow(/用户内容/);expect(readFileSync(join(target,'USER.md'),'utf8')).toBe('MY_DATA');expect(registry.list().items[0].managed).toBe(true);
});
it('native-login Claude uses a namespaced per-run plugin and never writes its native directory',()=>{
  file(join(root,'home/.agents/skills/echo/SKILL.md'),'---\nname: echo\ndescription: Codex source\n---\n');contexts.push({...contexts[0],runner:'codex',stateRoot:join(root,'home/.codex')});registry.scan();registry.adoptAll();const result=projection.prepare({...input,runner:'claude',stateRoot:join(root,'home/.claude'),nativeLogin:true});
  expect(result.args).toEqual(['--plugin-dir',join(root,'runs/a/willyou-run')]);expect(JSON.parse(readFileSync(join(root,'runs/a/willyou-run/.claude-plugin/plugin.json'),'utf8')).name).toBe('willyou-run');
  expect(existsSync(join(root,'home/.claude/skills/.willyou-managed.json'))).toBe(false);
});
it('separates simultaneous Claude project plugins and revocation leaves already prepared run intact',()=>{
  skill('project-skill',true);registry.scan();const id=registry.adoptAll().items[0].id;
  const a=projection.prepare({...input,runner:'claude'}),b=projection.prepare({...input,runner:'claude',cwd:join(root,'other'),runRoot:join(root,'runs/b')});expect(a.configured).toEqual([id]);expect(b.configured).toEqual([]);
  registry.setManaged(id,false);expect(existsSync(join(root,'runs/a/willyou-run/skills/project-skill/SKILL.md'))).toBe(true);expect(projection.prepare({...input,runner:'claude',runRoot:join(root,'runs/c')}).configured).toEqual([]);
});
it('uses the real Git exclude path, preserves unrelated lines, and removes only its concrete link entry',()=>{
  git(join(root,'project'),'init','--quiet');skill('local',true);registry.scan();const id=registry.adoptAll().items[0].id;file(join(root,'project/.git/info/exclude'),'# USER\nuser-private\n');
  expect(projection.prepare(input).configured).toEqual([id]);const path=join(root,'project/.git/info/exclude');expect(readFileSync(path,'utf8')).toContain('/.agents/skills/local\n');expect(git(join(root,'project'),'status','--porcelain')).not.toContain('.agents');
  registry.setManaged(id,false);expect(readFileSync(path,'utf8')).toBe('# USER\nuser-private\n');
});
it('checks all Codex loading roots and refuses a tracked target',()=>{
  skill('echo');registry.scan();registry.adoptAll();file(join(root,'home/.codex/skills/echo/SKILL.md'),'USER');expect(projection.prepare(input).issues[0].reason).toContain('其他 Codex');expect(existsSync(join(root,'home/.agents/skills/echo'))).toBe(false);
  rmSync(join(root,'home/.codex'),{recursive:true});git(join(root,'project'),'init','--quiet');skill('tracked',true);registry.scan();registry.adoptAll();
  file(join(root,'project/.agents/skills/tracked/SKILL.md'),'TRACKED');git(join(root,'project'),'add','.agents/skills/tracked/SKILL.md');
  expect(projection.prepare(input).issues.some(x=>x.reason.includes('Git 跟踪'))).toBe(true);expect(readFileSync(join(root,'project/.agents/skills/tracked/SKILL.md'),'utf8')).toBe('TRACKED');
});
it('supports a real worktree exclude location and warns about non-Git project visibility',()=>{
  const repo=join(root,'project');git(repo,'init','--quiet');git(repo,'-c','user.name=qa','-c','user.email=qa@example.invalid','commit','--quiet','--allow-empty','-m','synthetic');
  const worktree=join(root,'worktree');git(repo,'worktree','add','--quiet','--detach',worktree);
  file(join(worktree,'.claude/skills/local/SKILL.md'),'---\nname: local\ndescription: worktree\n---\n');contexts=[{...contexts[0],cwd:worktree,projectRoot:worktree}];registry.scan();const id=registry.adoptAll().items.find(x=>x.name==='local')!.id;
  expect(projection.prepare({...input,cwd:worktree}).configured).toEqual([id]);const exclude=git(worktree,'rev-parse','--git-path','info/exclude');expect(readFileSync(exclude,'utf8')).toContain('/.agents/skills/local');registry.setManaged(id,false);expect(readFileSync(exclude,'utf8')).not.toContain('WillYou managed');
  const plain=join(root,'plain');file(join(plain,'.claude/skills/plain/SKILL.md'),'---\nname: plain\ndescription: nonGit\n---\n');contexts=[{...contexts[0],cwd:plain,projectRoot:plain}];registry.scan();registry.adoptAll();const result=projection.prepare({...input,cwd:plain});expect(result.configured).toHaveLength(1);expect(result.issues[0].reason).toContain('不是 Git');
});
