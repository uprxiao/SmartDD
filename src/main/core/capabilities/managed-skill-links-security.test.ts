import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,lstatSync,existsSync,rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ManagedSkillLinks } from './managed-skill-links';
let dir:string,target:string,source:string;
const base=process.env.WILLYOU_MANAGED_LINK_TEST_ROOT??tmpdir();
function record(name:string,data:unknown){const p=process.env.WILLYOU_MANAGED_LINK_TEST_ARTIFACTS;if(p)writeFileSync(join(p,name+'.json'),JSON.stringify(data,null,2));}
beforeEach(()=>{dir=mkdtempSync(join(base,'willyou-managed-skill-links-security-'));source=join(dir,'source');target=join(dir,'target');mkdirSync(source);writeFileSync(join(source,'SKILL.md'),'---\nname: synthetic\ndescription: prototype-key control\n---\nPUBLIC\n');});
afterEach(()=>rmSync(dir,{recursive:true,force:true}));
it('rejects __proto__ basename before creating an unowned target',()=>{
 const m=new ManagedSkillLinks(target);let error:unknown;let result:unknown;
 try{result=m.link('__proto__',source);}catch(e){error=e;}
 const path=join(target,'__proto__'),journal=join(target,'.willyou-managed.json');record('prototype-name',{error:String(error),result,targetPresent:existsSync(path),targetSymlink:existsSync(path)&&lstatSync(path).isSymbolicLink(),journal:existsSync(journal)?readFileSync(journal,'utf8'):null});
 expect(error).toBeInstanceOf(Error);expect(existsSync(path)).toBe(false);expect(existsSync(journal)).toBe(false);
});
it('rejects an existing journal with __proto__ rather than silently discarding and rewriting it',()=>{
 const m=new ManagedSkillLinks(target),journal=join(target,'.willyou-managed.json');
 const bytes='{"schema":1,"owner":"WillYou","entries":{"__proto__":{"source":'+JSON.stringify(source)+',"inode":123,"device":456}}}\n';writeFileSync(journal,bytes);
 let inspectError:unknown;let inspected:unknown;try{inspected=m.inspect();}catch(e){inspectError=e;}
 let mutationError:unknown;try{m.link('ordinary',source);}catch(e){mutationError=e;}
 const after=readFileSync(journal,'utf8');record('prototype-journal',{inspectError:String(inspectError),inspected,mutationError:String(mutationError),before:bytes,after,ordinaryCreated:existsSync(join(target,'ordinary'))});
 expect(inspectError).toBeInstanceOf(Error);expect(mutationError).toBeInstanceOf(Error);expect(after).toBe(bytes);expect(existsSync(join(target,'ordinary'))).toBe(false);
});
