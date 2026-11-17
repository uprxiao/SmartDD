import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { MessageLinks } from './message-links';
import { inlineCodeFilePathCandidate } from '@shared/t3-links/markdownLinks';
const cleanup:(()=>void)[]=[];afterEach(()=>cleanup.splice(0).forEach(f=>f()));
function fixture(){
 const base=realpathSync(mkdtempSync(join(tmpdir(),'m14-links-'))),main=join(base,'main'),child=join(base,'work copy'),outside=join(base,'outside');for(const p of[main,child,outside])mkdirSync(p);
 const db=new Database(':memory:');db.pragma('foreign_keys=ON');runBundledMigrations(db);const store=new AgentStore(db);
 const create=(cwd:string)=>store.createTask({projectId:null,dirId:null,cwd,title:'links',selection:{driverId:'codex-app-server',profileId:'p',tier:'ask'}}),parentId=create(main),childId=create(child);
 const source=(id:string)=>[{kind:'task-cwd' as const,id,path:id===parentId?main:child,label:'own',projectId:null}];
 const links=new MessageLinks(store,{sources:s=>source(s.kind==='task'?s.taskId:'')},base),item=(id:string)=>store.addHostItem(id,null,'system_notice',{text:'Message links'});
 const parentItem=item(parentId),childItem=item(childId);cleanup.push(()=>{db.close();rmSync(base,{recursive:true,force:true});});return{base,main,child,outside,parentId,childId,parentItem,childItem,links};
}
it('A57/A58: identical filenames and absolute paths are routed by the message task/workspace, preserving line/column',async()=>{
 const f=fixture();writeFileSync(join(f.main,'a.ts'),'parent');writeFileSync(join(f.child,'a.ts'),'child');
 expect(await f.links.resolve({taskId:f.parentId,itemId:f.parentItem,href:'a.ts:2:3'})).toMatchObject({kind:'file',absolutePath:join(f.main,'a.ts'),line:2,column:3});
 expect(await f.links.resolve({taskId:f.childId,itemId:f.childItem,href:join(f.child,'a.ts')+':4'})).toMatchObject({kind:'file',absolutePath:join(f.child,'a.ts'),line:4});
 await expect(f.links.resolve({taskId:f.childId,itemId:f.parentItem,href:'a.ts'})).rejects.toThrow('不属于');
 await expect(f.links.resolve({taskId:f.childId,itemId:f.childItem,href:join(f.main,'a.ts')})).rejects.toThrow('越出了');
});
it('A57: decode once, preserve a literal percent path, and reject symlink escape, invalid positions, network paths and protocols',async()=>{
 const f=fixture();writeFileSync(join(f.child,'literal%2F.ts'),'literal');writeFileSync(join(f.outside,'secret.txt'),'outside');symlinkSync(f.outside,join(f.child,'escape'));
 expect(await f.links.resolve({taskId:f.childId,itemId:f.childItem,href:'./literal%252F.ts'})).toMatchObject({relativePath:'literal%2F.ts'});
 for(const href of ['escape/secret.txt','javascript:alert(1)','file://remote.invalid/share/a','literal%252F.ts%3A0','literal%252F.ts:2:0','file:///tmp/%00','bad%zz'])await expect(f.links.resolve({taskId:f.childId,itemId:f.childItem,href})).rejects.toThrow();
});
it('D2: pinned inline identification keeps bare names and paths with spaces as text',()=>{
 expect(inlineCodeFilePathCandidate('notes.txt')).toBeNull();expect(inlineCodeFilePathCandidate('src/main.ts')).toBe('src/main.ts');expect(inlineCodeFilePathCandidate('/Users/fixture/Library/Application Support/a.ts')).toBeNull();
});
it('A57: directories are distinct routes; a task without a project cannot open a web tab',async()=>{
 const f=fixture();mkdirSync(join(f.child,'folder'));expect(await f.links.resolve({taskId:f.childId,itemId:f.childItem,href:'folder/'})).toMatchObject({kind:'file',directory:true,relativePath:'folder'});
 await expect(f.links.resolve({taskId:f.childId,itemId:f.childItem,href:'https://example.invalid/a'})).rejects.toThrow('关联项目');
});
