import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {cleanupPreLibraryCopies} from '../legacy-copy-cleanup';

/** M11 R1.0 T45: only marked pre-R1.0 copies go; user Skills and other WillYou data directories stay. */
let home:string;const store='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const skill=(name:string,files:Record<string,string>)=>{const dir=join(home,'.agents/skills',name);mkdirSync(dir,{recursive:true});for(const[f,t]of Object.entries(files))writeFileSync(join(dir,f),t);return dir;};
const runtime=()=>{const dir=join(home,'.agents/smartdd-runtime');mkdirSync(join(dir,'catalog-consumers'),{recursive:true});writeFileSync(join(dir,'.willyou-catalog-root.json'),JSON.stringify({homeId:'h',initialized:true,owner:'SmartDD',schema:1}));};
beforeEach(()=>{home=mkdtempSync(join(tmpdir(),'willyou-cleanup-'));});
afterEach(()=>rmSync(home,{recursive:true,force:true}));

describe('M11 R1.0 pre-library copy cleanup',()=>{
 it('removes this store\'s copies, M4 copies and the coordination directory, and leaves user Skills byte-identical',()=>{
  skill('smartdd-a-zentao-bug-analysis-5d6f',{'SKILL.md':'old','.willyou-owned-bundle.json':JSON.stringify({schema:1,storeId:store,hash:'x'})});
  skill('smartdd-remote-password-ssh-d4fa',{'SKILL.md':'m4','.smartdd-owned.json':JSON.stringify({owner:'SmartDD',schema:1})});
  const user=skill('remote-password-ssh',{'SKILL.md':'user skill'}),sameName=skill('smartdd-mine',{'SKILL.md':'user named smartdd'});runtime();
  const result=cleanupPreLibraryCopies({home,storeId:store,unattributable:true});
  expect(result.removed.sort()).toEqual(['.agents/skills/smartdd-a-zentao-bug-analysis-5d6f','.agents/skills/smartdd-remote-password-ssh-d4fa','.agents/smartdd-runtime']);
  expect(result.kept).toEqual([{name:'.agents/skills/smartdd-mine',reason:'unmarked'}]);
  expect(readFileSync(join(user,'SKILL.md'),'utf8')).toBe('user skill');expect(readFileSync(join(sameName,'SKILL.md'),'utf8')).toBe('user named smartdd');
  expect(cleanupPreLibraryCopies({home,storeId:store,unattributable:true})).toEqual({removed:[],kept:[{name:'.agents/skills/smartdd-mine',reason:'unmarked'}]});
 });
 it('keeps another store\'s copies and, while they exist, the shared coordination directory and M4 copies',()=>{
  skill('smartdd-a-x',{'.willyou-owned-bundle.json':JSON.stringify({schema:1,storeId:other})});skill('smartdd-m4',{'.smartdd-owned.json':JSON.stringify({owner:'SmartDD',schema:1})});runtime();
  const result=cleanupPreLibraryCopies({home,storeId:store,unattributable:true});
  expect(result.removed).toEqual([]);expect(result.kept.map(k=>k.reason).sort()).toEqual(['other-store','unattributable','unattributable']);expect(existsSync(join(home,'.agents/smartdd-runtime'))).toBe(true);
 });
 it('outside a packaged App keeps unattributable copies, and finishes an interrupted removal',()=>{
  skill('smartdd-m4',{'.smartdd-owned.json':JSON.stringify({owner:'SmartDD',schema:1})});mkdirSync(join(home,'.agents/skills/.willyou-trash-left'),{recursive:true});
  const result=cleanupPreLibraryCopies({home,storeId:store,unattributable:false});
  expect(result.removed).toEqual([]);expect(result.kept).toEqual([{name:'.agents/skills/smartdd-m4',reason:'unattributable'}]);expect(existsSync(join(home,'.agents/skills/.willyou-trash-left'))).toBe(false);
 });
});
