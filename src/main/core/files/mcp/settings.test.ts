import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDbClient} from '@main/db/client';
import {runBundledMigrations} from '@main/db/migrations';
import {SettingsStore} from '@main/core/settings/settings-service';
import {FileViewerService} from './service';
const cleanups:(()=>void)[]=[];afterEach(()=>{for(const f of cleanups.splice(0))f()});
describe('MCP explicit adapter preferences',()=>{
 it('persists only validated explicit registrations through real SettingsStore and survives database reopen',async()=>{
  const base=mkdtempSync(join(tmpdir(),'willyou-mcp-settings-')),path=join(base,'preferences.sqlite');let db=openDbClient(path);runBundledMigrations(db.sqlite);let settings=new SettingsStore(db.db);cleanups.push(()=>{db.close();rmSync(base,{recursive:true,force:true})});
  const config={adapters:[{id:'compound',name:'Compound fixture',enabled:true,suffixes:['.bar.foo'],sources:['project-directory' as const],provider:{kind:'local-resource' as const,writable:true}}],preferred:{'.foo':'compound'}};
  const create=()=>new FileViewerService(()=>{throw new Error('No file authorization in settings test')},{get:()=>settings.get('fileViewers'),set:value=>settings.update('fileViewers',value)});
  const host=create();await host.configure(config);expect(JSON.parse((db.sqlite.prepare("SELECT value FROM app_settings WHERE key='fileViewers'").get() as {value:string}).value)).toEqual(config);
  await expect(host.configure({...config,adapters:[...config.adapters,...config.adapters]})).rejects.toThrow();await expect(host.configure({...config,adapters:[{...config.adapters[0],provider:{kind:'local-resource',writable:true,arbitraryPath:'/etc/passwd'}}]})).rejects.toThrow();
  db.close();db=openDbClient(path);settings=new SettingsStore(db.db);expect(create().configuration()).toEqual(config);
 });
});
