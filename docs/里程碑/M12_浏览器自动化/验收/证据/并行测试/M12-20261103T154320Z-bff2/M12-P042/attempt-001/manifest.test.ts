import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe,it,expect} from 'vitest';
const root=fileURLToPath(new URL('./inputs/',import.meta.url));
const read=(path:string)=>JSON.parse(readFileSync(root+path,'utf8'));
const capabilities=read('manifest.json').capabilities;
const commands=read('browser-commands.generated.json');
const byCommand=(...parts:string[])=>capabilities.find((c:any)=>JSON.stringify(c.binding.cli.command)===JSON.stringify(['browser',...parts]));
describe('M12-T093 actual bundled manifest authority',()=>{
 it('declares exactly82 unique commands matching the generated contract',()=>{expect(capabilities).toHaveLength(82);expect(new Set(capabilities.map((c:any)=>c.id)).size).toBe(82);expect(capabilities.map((c:any)=>c.id).sort()).toEqual(commands.map((c:any)=>c.id).sort());for(const c of capabilities){const original=commands.find((v:any)=>v.id===c.id);expect(c.binding.cli.command).toEqual(original.command);expect(c.semantics).toBe(original.semantics);}});
 it('contains exactly21 reads and61 writes, with no external-write',()=>{expect(capabilities.filter((c:any)=>c.semantics==='read')).toHaveLength(21);expect(capabilities.filter((c:any)=>c.semantics==='write')).toHaveLength(61);expect([...new Set(capabilities.map((c:any)=>c.semantics))].sort()).toEqual(['read','write']);});
 it('all reads are safe-read and all writes require receipts and never retry',()=>{for(const c of capabilities){expect(c.permission).toBe('browser.'+c.semantics);if(c.semantics==='read'){expect(c.retry).toBe('safe-read');expect(c.protection).toBeUndefined();}else{expect(c.retry).toBe('never');expect(c.protection).toEqual({kind:'operation-receipt',object:'browser_operation',key:'requestId'});}}});
 it('operation get is read, scripted wait and access request are write',()=>{expect(byCommand('operation','get').semantics).toBe('read');expect(byCommand('wait','fn').semantics).toBe('write');expect(byCommand('access','request').semantics).toBe('write');});
 it('read-only wait rejects fn rather than admitting a hidden write parameter',()=>{const wait=byCommand('wait');expect(wait.semantics).toBe('read');const input=read(wait.inputSchemaPath);expect(input.properties).not.toHaveProperty('fn');expect(input.additionalProperties).toBe(false);});
});
