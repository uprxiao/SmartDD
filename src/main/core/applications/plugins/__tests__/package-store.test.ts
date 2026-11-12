import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {existsSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import Database from 'better-sqlite3';
import {runBundledMigrations} from '../../../../db/migrations';
import {ResourceStore} from '../../resource-store';
import {PluginPackageStore} from '../package-store';
import {validatePluginBundle} from '../package';
import {fixture} from './fixture';

let root:string,sqlite:Database.Database,resources:ResourceStore,packages:PluginPackageStore;
beforeEach(()=>{
  root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m13-package-store-')));
  sqlite=new Database(join(root,'smartdd.db'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);
  resources=new ResourceStore(sqlite,root);packages=new PluginPackageStore(resources);
});
afterEach(()=>{sqlite.close();rmSync(root,{recursive:true,force:true});});
describe('durable external plugin package store',()=>{
  it('publishes and reuses a fully owned tree without changing the host package or activating it',()=>{
    const host=join(root,'host-package.sentinel');writeFileSync(host,'SYNTHETIC_HOST_PACKAGE');
    const plugin=validatePluginBundle(fixture().bundle()),first=packages.publish(plugin);
    expect(first.plugin.hash).toBe(plugin.hash);expect(packages.publish(plugin).directory).toBe(first.directory);
    expect(new PluginPackageStore(resources).get(plugin.hash).plugin.hash).toBe(plugin.hash);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM plugin_packages').get()).toEqual({n:1});
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM plugin_installations').get()).toEqual({n:0});
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM capability_builtin_package_sources').get()).toEqual({n:0});
    expect(readFileSync(host,'utf8')).toBe('SYNTHETIC_HOST_PACKAGE');
  });
  it('publishing a new version preserves the active old package',()=>{
    const f=fixture(),old=packages.publish(validatePluginBundle(f.bundle()));
    sqlite.prepare('INSERT INTO plugin_installations VALUES(?,?,1,1,1,?)').run('demo-tracker',old.plugin.hash,new Date().toISOString());
    f.manifest.version='0.2.0';const next=packages.publish(validatePluginBundle(f.bundle()));
    expect(next.plugin.manifest.version).toBe('0.2.0');
    expect(sqlite.prepare('SELECT package_hash FROM plugin_installations').get()).toEqual({package_hash:old.plugin.hash});
    expect(()=>packages.removeUnused(old.plugin.hash)).toThrow('引用');
    expect(packages.removeUnused(next.plugin.hash)).toBe(true);expect(packages.list()).toHaveLength(1);
  });
  it('rejects source changes and native content before creating an install record or private data',()=>{
    const f=fixture(),candidate=validatePluginBundle(f.bundle());
    (candidate.files as Map<string,Buffer>).set('runtime/evil.node',Buffer.from('native'));
    expect(()=>packages.publish(candidate)).toThrow('原生');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM plugin_packages').get()).toEqual({n:0});
    expect(existsSync(join(root,'plugin-data'))).toBe(false);
  });
  it('detects full-tree tampering and refuses forged database paths',()=>{
    const stored=packages.publish(validatePluginBundle(fixture().bundle()));
    writeFileSync(join(stored.directory,'runtime/main.mjs'),'tampered');
    expect(()=>packages.get(stored.plugin.hash)).toThrow('内容');
    sqlite.prepare('UPDATE plugin_packages SET relative_path=?').run('../foreign');
    expect(()=>packages.get(stored.plugin.hash)).toThrow('目录记录');
  });
  it('recovers an exact owned directory left by a failed SQL commit without replacing it',()=>{
    const plugin=validatePluginBundle(fixture().bundle());
    sqlite.exec("CREATE TRIGGER fail_plugin_insert AFTER INSERT ON plugin_packages BEGIN SELECT RAISE(ABORT,'synthetic transaction failure'); END");
    expect(()=>packages.publish(plugin)).toThrow('synthetic transaction failure');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM plugin_packages').get()).toEqual({n:0});
    sqlite.exec('DROP TRIGGER fail_plugin_insert');
    expect(packages.publish(plugin).plugin.hash).toBe(plugin.hash);expect(packages.list()).toHaveLength(1);
  });
  it('does not follow a redirected package parent or adopt a foreign owner',()=>{
    const foreign=join(root,'foreign');mkdirSync(foreign);mkdirSync(join(packages.root,'packages'));symlinkSync(foreign,join(packages.root,'packages/demo-tracker'));
    expect(()=>packages.publish(validatePluginBundle(fixture().bundle()))).toThrow();
    expect(existsSync(join(foreign,'0.1.0'))).toBe(false);
    const marker=join(packages.root,'.willyou-plugin-store.json');writeFileSync(marker,'{"schema":1,"storeId":"foreign"}');
    expect(()=>new PluginPackageStore(resources)).toThrow('归属');expect(readFileSync(marker,'utf8')).toContain('foreign');
  });
  it('rejects deleting packages referenced by an unfinished lifecycle operation',()=>{
    const stored=packages.publish(validatePluginBundle(fixture().bundle())),now=new Date().toISOString();
    sqlite.prepare("INSERT INTO plugin_lifecycle_changes VALUES('change','demo-tracker','update',NULL,?,0,0,'preparing','{}',NULL,'synthetic',?,?)").run(stored.plugin.hash,now,now);
    expect(()=>packages.removeUnused(stored.plugin.hash)).toThrow('引用');expect(existsSync(dirname(stored.directory))).toBe(true);
  });
  it('retains the owned package if deleting its SQL record fails',()=>{
    const stored=packages.publish(validatePluginBundle(fixture().bundle()));
    sqlite.exec("CREATE TRIGGER fail_plugin_delete BEFORE DELETE ON plugin_packages BEGIN SELECT RAISE(ABORT,'synthetic delete failure'); END");
    expect(()=>packages.removeUnused(stored.plugin.hash)).toThrow('synthetic delete failure');
    expect(packages.get(stored.plugin.hash).plugin.hash).toBe(stored.plugin.hash);
  });
  it('preserves script executable bits and includes them in package identity',()=>{
    const f=fixture();f.files.set('scripts/probe.sh',Buffer.from('#!/bin/sh\nexit 0\n'));
    const plain=validatePluginBundle(f.bundle()),executable=validatePluginBundle(f.bundle(),undefined,new Set(['scripts/probe.sh']));
    expect(executable.hash).not.toBe(plain.hash);
    expect(packages.publish(executable).plugin.executables.has('scripts/probe.sh')).toBe(true);
  });
  it('restores an owned package after an interrupted remove before the SQL commit',()=>{
    const stored=packages.publish(validatePluginBundle(fixture().bundle()));
    const trash=join(packages.root,'trash');mkdirSync(trash);renameSync(dirname(stored.directory),join(trash,stored.plugin.hash));
    expect(new PluginPackageStore(resources).get(stored.plugin.hash).plugin.hash).toBe(stored.plugin.hash);
    expect(existsSync(stored.directory)).toBe(true);
  });
  it('keeps an exact lifecycle pending lock unique and enforces the active-package FK',()=>{
    const stored=packages.publish(validatePluginBundle(fixture().bundle())),now=new Date().toISOString();
    sqlite.prepare('INSERT INTO plugin_installations VALUES(?,?,1,1,1,?)').run('demo-tracker',stored.plugin.hash,now);
    expect(()=>sqlite.prepare('DELETE FROM plugin_packages WHERE package_hash=?').run(stored.plugin.hash)).toThrow(/FOREIGN KEY/);
    const insert=sqlite.prepare("INSERT INTO plugin_lifecycle_changes VALUES(?,'demo-tracker','update',?,NULL,1,1,'preparing','{}',NULL,'synthetic',?,?)");
    insert.run('first',stored.plugin.hash,now,now);expect(()=>insert.run('second',stored.plugin.hash,now,now)).toThrow(/UNIQUE/);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
});
