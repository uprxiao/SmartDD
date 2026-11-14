import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readCodexGlobalSettings, codexGlobalSettingsChanged } from './codex-global-config';
const roots:string[]=[];const fixture=()=>{const r=mkdtempSync(join(tmpdir(),'m13-global-'));roots.push(r);return r;};
afterEach(()=>roots.splice(0).forEach(r=>rmSync(r,{recursive:true,force:true})));
it('reads TOML literal strings/comments and only top-level public model preferences without writing',()=>{
 const root=fixture(),path=join(root,'config.toml'),source=`# test\nmodel = 'public-model' # preserve\nmodel_reasoning_effort = "high"\napi_key = "PUBLIC_KEY_SENTINEL"\n[profiles.other]\nmodel = 'wrong'\n`;writeFileSync(path,source);
 expect(readCodexGlobalSettings(root)).toEqual({status:'readable',model:'public-model',effort:'high'});expect(readFileSync(path,'utf8')).toBe(source);
});
it('notices semantic changes rather than comments or unrelated settings, without restoring concurrent edits',()=>{
 const root=fixture(),p=join(root,'config.toml');writeFileSync(p,'model="a"\n');const before=readCodexGlobalSettings(root);writeFileSync(p,"# changed\nmodel='a'\napi_key='PUBLIC_ONLY'\n");expect(codexGlobalSettingsChanged(before,readCodexGlobalSettings(root))).toBe(false);
 const changed="model='b'\nmodel_reasoning_effort='max'\n";writeFileSync(p,changed);expect(codexGlobalSettingsChanged(before,readCodexGlobalSettings(root))).toBe(true);expect(readFileSync(p,'utf8')).toBe(changed);
});
it('treats missing as unset, and unreadable/invalid source as unknown without leaking parse excerpts',()=>{
 const root=fixture();expect(readCodexGlobalSettings(root)).toEqual({status:'missing',model:null,effort:null});writeFileSync(join(root,'config.toml'),'model = "PUBLIC_SECRET_BAD_TOML');const unknown=readCodexGlobalSettings(root);expect(unknown).toEqual({status:'unreadable',model:null,effort:null});expect(codexGlobalSettingsChanged(unknown,{status:'readable',model:'new',effort:null})).toBe(false);
});

it('rejects oversize or invalid UTF-8 rather than accepting replacement characters as a model',()=>{
 const root=fixture(),p=join(root,'config.toml');writeFileSync(p,'#'.repeat(1024*1024+1));expect(readCodexGlobalSettings(root).status).toBe('unreadable');
 writeFileSync(p,Buffer.concat([Buffer.from('model="'),Buffer.from([255]),Buffer.from('"')]));expect(readCodexGlobalSettings(root)).toEqual({status:'unreadable',model:null,effort:null});
});
