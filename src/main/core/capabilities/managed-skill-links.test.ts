import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as fs from 'node:fs';

const hooks = vi.hoisted(() => ({ beforeRename: undefined as undefined | ((from: string, to: string) => void), beforeWrite: undefined as undefined | ((path: string) => void), afterRename: undefined as undefined | ((from: string, to: string) => void) }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return { ...real,
    renameSync: ((from: fs.PathLike, to: fs.PathLike) => { hooks.beforeRename?.(String(from), String(to)); const result=real.renameSync(from, to); hooks.afterRename?.(String(from), String(to)); return result; }) as typeof real.renameSync,
    writeFileSync: ((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => { hooks.beforeWrite?.(String(file)); return real.writeFileSync(file, data, options); }) as typeof real.writeFileSync,
  };
});
import { ManagedSkillLinks } from './managed-skill-links';

const BASE = process.env.WILLYOU_MANAGED_LINK_TEST_ROOT ?? tmpdir();
let root: string, targetRoot: string, source: string;
const journal = () => join(targetRoot, '.willyou-managed.json');
const lock = () => join(targetRoot, '.willyou-managed.lock');
function put(path: string, bytes: string) { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, bytes); }
function skill(dir: string, version = 'v1') { put(join(dir, 'SKILL.md'), `---\nname: public-fixture\ndescription: filesystem-only test\n---\nVERSION=${version}\nRead scripts/hello.sh relative to this Skill.\n`); put(join(dir, 'scripts/hello.sh'), `#!/bin/sh\nprintf '%s\\n' '${version}'\n`); return dir; }
function manager() { return new ManagedSkillLinks(targetRoot); }
function noTemporaryFiles() { expect(fs.readdirSync(targetRoot).filter(x => x.includes('.tmp-') || x.includes('link-held-') || x.endsWith('.lock'))).toEqual([]); }
function snapshotSource() { return [fs.readFileSync(join(source, 'SKILL.md'), 'utf8'), fs.readFileSync(join(source, 'scripts/hello.sh'), 'utf8')]; }
function artifact(name: string, data: unknown) { const dir=process.env.WILLYOU_MANAGED_LINK_TEST_ARTIFACTS; if(dir) put(join(dir, name+'.json'), JSON.stringify(data, null, 2)); }
beforeEach(() => { root = fs.realpathSync(fs.mkdtempSync(join(BASE, 'willyou-managed-skill-links-fixture-'))); targetRoot = join(root, 'target'); source = skill(join(root, 'source')); });
afterEach(() => { hooks.beforeRename = undefined; hooks.beforeWrite = undefined; hooks.afterRename=undefined; fs.rmSync(root, { recursive: true, force: true }); });

describe('R03 filesystem ownership, isolated synthetic files only', () => {
  it('links the complete Skill directory with relative script bytes without changing source', () => {
    const original = snapshotSource(), m = manager(), r = m.link('demo', source);
    expect(r).toEqual({ state:'linked', target:join(targetRoot,'demo'), source });
    expect(fs.lstatSync(r.target).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(join(r.target,'SKILL.md'),'utf8')).toContain('VERSION=v1');
    expect(fs.readFileSync(join(r.target,'scripts/hello.sh'),'utf8')).toContain("'v1'");
    expect(snapshotSource()).toEqual(original); expect(fs.statSync(journal()).mode & 0o777).toBe(0o600); noTemporaryFiles();
  });
  it('follows source updates in one direction while preserving the target inode and source bytes', () => {
    const m=manager();m.link('demo',source);const inode=fs.lstatSync(join(targetRoot,'demo')).ino;
    skill(source,'v2');const updated=snapshotSource();m.link('demo',source);
    expect(fs.readFileSync(join(targetRoot,'demo/SKILL.md'),'utf8')).toContain('VERSION=v2');
    expect(fs.readFileSync(join(targetRoot,'demo/scripts/hello.sh'),'utf8')).toContain("'v2'");
    expect(fs.lstatSync(join(targetRoot,'demo')).ino).toBe(inode); expect(snapshotSource()).toEqual(updated);noTemporaryFiles();
  });
  it('repeated link and reconstruction retain ownership without duplicate entries or inode changes',()=>{
    const m=manager();m.link('demo',source);const before=fs.readFileSync(journal(),'utf8'),ino=fs.lstatSync(join(targetRoot,'demo')).ino;
    expect(m.link('demo',source).state).toBe('linked');const reloaded=manager();expect(reloaded.link('demo',source).state).toBe('linked');
    expect(reloaded.inspect()).toEqual([{name:'demo',source,target:join(targetRoot,'demo'),owned:true,sourcePresent:true}]);
    expect(fs.readFileSync(journal(),'utf8')).toBe(before);expect(fs.lstatSync(join(targetRoot,'demo')).ino).toBe(ino);noTemporaryFiles();
  });
  it('cancel removes only an exact owned link and keeps source and unrelated user files',()=>{
    const m=manager(),original=snapshotSource();m.link('demo',source);put(join(targetRoot,'user','note'),'KEEP');
    expect(m.remove('user')).toBe(false);expect(m.remove('demo')).toBe(true);expect(m.remove('demo')).toBe(false);
    expect(fs.existsSync(join(targetRoot,'demo'))).toBe(false);expect(fs.readFileSync(join(targetRoot,'user/note'),'utf8')).toBe('KEEP');expect(snapshotSource()).toEqual(original);expect(m.inspect()).toEqual([]);noTemporaryFiles();
  });
  it.each(['file','directory','dangling-link'] as const)('same-name user %s conflicts without adopting or overwriting', kind=>{
    const m=manager(),path=join(targetRoot,'demo');
    if(kind==='file')put(path,'USER'); else if(kind==='directory')put(join(path,'note'),'USER'); else fs.symlinkSync(join(root,'absent'),path);
    const ino=fs.lstatSync(path).ino;
    expect(()=>m.link('demo',source)).toThrow(/目标已存在/);expect(fs.lstatSync(path).ino).toBe(ino);expect(fs.existsSync(journal())).toBe(false);
    expect(m.remove('demo')).toBe(false);if(kind==='dangling-link')expect(fs.readlinkSync(path)).toBe(join(root,'absent'));noTemporaryFiles();
  });
  it.each(['symlink','same-directory'] as const)('native same-source %s is not journal-owned and cannot be cancelled', kind=>{
    const m=manager();let src=source;
    if(kind==='symlink')fs.symlinkSync(source,join(targetRoot,'demo'));else src=skill(join(targetRoot,'demo'));
    const ino=fs.lstatSync(join(targetRoot,'demo')).ino;expect(m.link('demo',src).state).toBe('native');expect(m.inspect()).toEqual([]);
    expect(m.remove('demo')).toBe(false);expect(fs.lstatSync(join(targetRoot,'demo')).ino).toBe(ino);expect(fs.existsSync(journal())).toBe(false);noTemporaryFiles();
  });
  it('a different same-name source cannot replace an owned source',()=>{
    const m=manager();m.link('demo',source);const second=skill(join(root,'second'));expect(()=>m.link('demo',second)).toThrow(/另一来源/);expect(fs.readlinkSync(join(targetRoot,'demo'))).toBe(source);noTemporaryFiles();
  });
  it('a missing owned link can be repaired after restart without changing the source',()=>{
    manager().link('demo',source);fs.rmSync(join(targetRoot,'demo'));expect(manager().link('demo',source).state).toBe('linked');expect(manager().inspect()[0].owned).toBe(true);noTemporaryFiles();
  });
  it('source deletion cleans only the owned dangling link and its journal entry',()=>{
    const m=manager();m.link('demo',source);fs.rmSync(source,{recursive:true});expect(m.inspect()[0]).toMatchObject({owned:true,sourcePresent:false});
    expect(m.cleanupMissingSources()).toEqual({removed:['demo'],held:[]});expect(m.inspect()).toEqual([]);expect(fs.existsSync(join(targetRoot,'demo'))).toBe(false);noTemporaryFiles();
  });
  it.each(['file','directory','symlink'] as const)('user replacement %s is held and never removed on cancel or missing-source cleanup',kind=>{
    const m=manager(),path=join(targetRoot,'demo');m.link('demo',source);fs.rmSync(path);
    if(kind==='file')put(path,'USER');else if(kind==='directory')put(join(path,'note'),'USER');else fs.symlinkSync(join(root,'user-target'),path);
    const ino=fs.lstatSync(path).ino;expect(()=>m.remove('demo')).toThrow(/不会删除用户内容/);expect(()=>m.link('demo',source)).toThrow(/保留用户内容/);
    fs.rmSync(source,{recursive:true});expect(m.cleanupMissingSources()).toEqual({removed:[],held:['demo']});expect(fs.lstatSync(path).ino).toBe(ino);expect(m.inspect()[0].owned).toBe(false);noTemporaryFiles();
  });
  it.each(['bad-json','bad-schema','directory','symlink'] as const)('unverifiable %s manifest fails closed and remains unchanged',kind=>{
    const m=manager();m.link('demo',source);const src=snapshotSource(),targetIno=fs.lstatSync(join(targetRoot,'demo')).ino;fs.rmSync(journal());
    if(kind==='bad-json')put(journal(),'{broken');else if(kind==='bad-schema')put(journal(),JSON.stringify({schema:99,owner:'User',entries:{}}));else if(kind==='directory')fs.mkdirSync(journal());else{put(join(root,'external-journal'),'PRIVATE USER CONTENT');fs.symlinkSync(join(root,'external-journal'),journal());}
    const jino=fs.lstatSync(journal()).ino;
    expect(()=>m.inspect()).toThrow(/不可核验/);expect(()=>m.remove('demo')).toThrow(/不可核验/);expect(()=>m.link('second',source)).toThrow(/不可核验/);expect(()=>m.cleanupMissingSources()).toThrow(/不可核验/);
    expect(fs.lstatSync(journal()).ino).toBe(jino);expect(fs.lstatSync(join(targetRoot,'demo')).ino).toBe(targetIno);expect(snapshotSource()).toEqual(src);if(kind==='symlink')expect(fs.readFileSync(join(root,'external-journal'),'utf8')).toBe('PRIVATE USER CONTENT');noTemporaryFiles();
  });
  it('an existing lock fails closed and is never unlinked by another manager',()=>{
    const m=manager();put(lock(),'OTHER OWNER');const ino=fs.lstatSync(lock()).ino;expect(()=>m.link('demo',source)).toThrow(/不覆盖锁/);expect(()=>m.inspect()).toThrow(/不覆盖锁/);
    expect(fs.lstatSync(lock()).ino).toBe(ino);expect(fs.readFileSync(lock(),'utf8')).toBe('OTHER OWNER');expect(fs.existsSync(join(targetRoot,'demo'))).toBe(false);
  });
  it('a replaced lock inode remains owned by its external writer',()=>{
    const m=manager();hooks.beforeRename=(_from,to)=>{if(to===journal()){hooks.beforeRename=undefined;fs.rmSync(lock());put(lock(),'REPLACED LOCK');}};
    m.link('demo',source);expect(fs.readFileSync(lock(),'utf8')).toBe('REPLACED LOCK');expect(fs.readFileSync(join(targetRoot,'demo/SKILL.md'),'utf8')).toContain('v1');
  });
  it.each(['constructor','toString'])('legal basename %s roundtrips across restart and cancellation',name=>{
    const original=snapshotSource();manager().link(name,source);expect(manager().inspect()).toEqual([{name,source,target:join(targetRoot,name),owned:true,sourcePresent:true}]);expect(manager().remove(name)).toBe(true);expect(snapshotSource()).toEqual(original);noTemporaryFiles();
  });
  it('rejects traversal, reserved dot names, separators, controls, and overlong names before writes',()=>{
    const m=manager(),before=fs.readdirSync(targetRoot);for(const name of ['','.', '..','../escape','/absolute','a/b','a\\b','a\0b','a\nb','a\x7fb','x'.repeat(256)])expect(()=>m.link(name,source)).toThrow(/单个目录名/);
    expect(fs.readdirSync(targetRoot)).toEqual(before);expect(()=>m.remove('../escape')).toThrow();expect(fs.existsSync(join(root,'escape'))).toBe(false);noTemporaryFiles();
  });
  it('rejects relative roots/sources and sources without a regular SKILL.md',()=>{
    expect(()=>new ManagedSkillLinks('relative')).toThrow(/绝对路径/);const m=manager();expect(()=>m.link('demo','relative')).toThrow(/绝对路径/);
    const absent=join(root,'absent');expect(()=>m.link('demo',absent)).toThrow(/普通 SKILL/);fs.mkdirSync(absent);fs.symlinkSync(join(source,'SKILL.md'),join(absent,'SKILL.md'));expect(()=>m.link('demo',absent)).toThrow(/普通 SKILL/);noTemporaryFiles();
  });
  it('does not write a journal inside the source tree, including through a source alias',()=>{
    const within=join(source,'nested','target'),m=new ManagedSkillLinks(within),alias=join(root,'source-alias');fs.symlinkSync(source,alias);
    expect(()=>m.link('demo',source)).toThrow(/来源目录内/);expect(()=>m.link('demo',alias)).toThrow(/来源目录内/);expect(fs.readdirSync(within)).toEqual([]);
  });
  it('failed journal write rolls back only its own newly created link and leaves source untouched',()=>{
    const m=manager(),original=snapshotSource();hooks.beforeWrite=p=>{if(p.includes('.willyou-managed.json.tmp-'))throw new Error('SYNTHETIC_DISK_FAILURE');};
    expect(()=>m.link('demo',source)).toThrow('SYNTHETIC_DISK_FAILURE');hooks.beforeWrite=undefined;
    expect(fs.existsSync(join(targetRoot,'demo'))).toBe(false);expect(fs.existsSync(journal())).toBe(false);expect(snapshotSource()).toEqual(original);noTemporaryFiles();
  });
  it('atomic claim preserves a replacement file inserted after the owned precheck',()=>{
    const m=manager(),target=join(targetRoot,'demo');m.link('demo',source);const before=fs.readFileSync(journal(),'utf8');let replacedInode:number|undefined;
    hooks.beforeRename=(from,to)=>{if(from===target&&to.includes('.willyou-link-held-')){hooks.beforeRename=undefined;fs.rmSync(target);put(target,'RACING USER FILE');replacedInode=fs.lstatSync(target).ino;}};
    expect(()=>m.remove('demo')).toThrow(/原位保留/);expect(fs.readFileSync(target,'utf8')).toBe('RACING USER FILE');expect(fs.lstatSync(target).ino).toBe(replacedInode);expect(fs.readFileSync(journal(),'utf8')).toBe(before);noTemporaryFiles();artifact('race-file',{replacedInode,retainedInode:fs.lstatSync(target).ino,content:fs.readFileSync(target,'utf8'),sourceUntouched:snapshotSource()});
  });
  it('atomic claim holds an unexpected directory when hard-link restoration cannot restore it',()=>{
    const m=manager(),target=join(targetRoot,'demo');m.link('demo',source);const before=fs.readFileSync(journal(),'utf8');let held='';
    hooks.beforeRename=(from,to)=>{if(from===target&&to.includes('.willyou-link-held-')){hooks.beforeRename=undefined;fs.rmSync(target);put(join(target,'note'),'RACING USER DIRECTORY');held=to;}};
    expect(()=>m.remove('demo')).toThrow(/原件保留在/);expect(fs.readFileSync(join(held,'note'),'utf8')).toBe('RACING USER DIRECTORY');expect(fs.readFileSync(journal(),'utf8')).toBe(before);expect(fs.existsSync(target)).toBe(false);expect(fs.existsSync(lock())).toBe(false);artifact('race-directory',{held:held.replace(root,'<fixture>'),content:fs.readFileSync(join(held,'note'),'utf8')});
  });
  it('claim race preserves both the unexpected held file and a separately recreated target',()=>{
    const m=manager(),target=join(targetRoot,'demo');m.link('demo',source);const before=fs.readFileSync(journal(),'utf8');let held='';
    hooks.beforeRename=(from,to)=>{if(from===target&&to.includes('.willyou-link-held-')){hooks.beforeRename=undefined;fs.rmSync(target);put(target,'RACING ORIGINAL');held=to;}};
    hooks.afterRename=(from,to)=>{if(from===target&&to===held){hooks.afterRename=undefined;put(target,'RACING NEW OCCUPANT');}};
    expect(()=>m.remove('demo')).toThrow(/原件保留在/);expect(fs.readFileSync(held,'utf8')).toBe('RACING ORIGINAL');expect(fs.readFileSync(target,'utf8')).toBe('RACING NEW OCCUPANT');expect(fs.readFileSync(journal(),'utf8')).toBe(before);expect(fs.existsSync(lock())).toBe(false);
    artifact('race-both',{held:held.replace(root,'<fixture>'),heldContent:fs.readFileSync(held,'utf8'),targetContent:fs.readFileSync(target,'utf8')});
  });
  it('a new target created after an owned claim is preserved while only the owned inode is removed',()=>{
    const m=manager(),target=join(targetRoot,'demo');m.link('demo',source);
    // Inject via journal publication, after the old exact link was claimed/removed.
    hooks.beforeRename=(_from,to)=>{if(to===journal()){hooks.beforeRename=undefined;put(target,'NEW USER TARGET');}};
    expect(m.remove('demo')).toBe(true);expect(fs.readFileSync(target,'utf8')).toBe('NEW USER TARGET');expect(m.inspect()).toEqual([]);noTemporaryFiles();
  });
});
