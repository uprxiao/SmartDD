import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, linkSync, mkdirSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const entrySchema=z.object({source:z.string(),inode:z.number().int(),device:z.number().int()}).strict();
const journalSchema=z.object({schema:z.literal(1),owner:z.literal('WillYou'),entries:z.record(z.string(),entrySchema)}).strict();
type Journal=z.infer<typeof journalSchema>;
export type SkillLinkResult={state:'linked'|'native';target:string;source:string};
const stat=(path:string)=>{try{return lstatSync(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
const inside=(parent:string,path:string)=>{const rel=relative(parent,path);return rel===''||(rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel));};
function validName(name:string){if(name==='__proto__')throw new Error('该 Skill 名称不能作为纳管记录键');if(!name||name.startsWith('.')||/[\\/\x00-\x1f\x7f]/.test(name)||Buffer.byteLength(name)>255)throw new Error('Skill 名称不是合法的单个目录名');}

/** Filesystem ownership layer for R03 single-source Skill links. Main constructs
 * the approved target root. No source file is written, and native/user links are
 * never adopted as owned. Codex project Git exclusions and DB selection belong
 * to the caller; this module alone does not claim project/runtime delivery.
 */
export class ManagedSkillLinks {
  private readonly root:string;
  constructor(root:string){
    if(!isAbsolute(root))throw new Error('Skill 目标目录必须是绝对路径');
    mkdirSync(root,{recursive:true,mode:0o700});this.root=realpathSync(root);
  }
  private path(name:string){validName(name);return join(this.root,name);}
  private read():Journal {
    const path=join(this.root,'.willyou-managed.json'),s=stat(path);
    if(!s)return {schema:1,owner:'WillYou',entries:{}};
    if(!s.isFile()||s.isSymbolicLink()||s.size>1024*1024)throw new Error('Skill 纳管记录不可核验，保留全部目标');
    try{const raw=JSON.parse(readFileSync(path,'utf8'));
      // Zod intentionally strips __proto__; reject unknown ownership rather than
      // silently dropping it and rewriting a truncated record.
      if(raw&&typeof raw==='object'&&raw.entries&&typeof raw.entries==='object')Object.keys(raw.entries).forEach(validName);
      return journalSchema.parse(raw);
    }catch{throw new Error('Skill 纳管记录不可核验，保留全部目标');}
  }
  private write(journal:Journal){
    const path=join(this.root,'.willyou-managed.json'),temporary=path+'.tmp-'+randomUUID();
    const bytes=JSON.stringify(journalSchema.parse(journal),null,2)+'\n';if(Buffer.byteLength(bytes)>1024*1024)throw new Error('Skill 纳管记录超过大小限制');
    try{writeFileSync(temporary,bytes,{mode:0o600,flag:'wx'});renameSync(temporary,path);}
    finally{rmSync(temporary,{force:true});}
  }
  private locked<T>(fn:(journal:Journal)=>T):T {
    const path=join(this.root,'.willyou-managed.lock');let fd:number;
    try{fd=openSync(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new Error('Skill 纳管记录正在使用或待恢复，不覆盖锁');throw e;}
    const ownership=fstatSync(fd);try{return fn(this.read());}finally{
      closeSync(fd);const now=stat(path);if(now?.ino===ownership.ino&&now.dev===ownership.dev)rmSync(path);
    }
  }
  private owned(target:string,entry:z.infer<typeof entrySchema>){
    const s=stat(target);return Boolean(s?.isSymbolicLink()&&s.ino===entry.inode&&s.dev===entry.device&&readlinkSync(target)===entry.source);
  }
  private removeExact(target:string,entry:z.infer<typeof entrySchema>):boolean {
    // Claim the directory entry atomically, then inspect what was actually moved.
    // Checking the pathname and unlinking it separately could delete a replacement.
    const held=join(this.root,'.willyou-link-held-'+randomUUID());
    try{renameSync(target,held);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}
    if(this.owned(held,entry)){rmSync(held);return true;}
    // Never overwrite a new target. Hard-link restore preserves an unexpected
    // file/symlink inode; directories or a newly occupied pathname remain held.
    try{linkSync(held,target);rmSync(held);}catch{throw new Error(`目标已被替换，原件保留在 ${held}，请恢复后重试`);}
    throw new Error('目标已被替换，已原位保留，取消纳管停止');
  }
  inspect(){return this.locked(journal=>Object.entries(journal.entries).map(([name,e])=>({name,source:e.source,target:this.path(name),owned:this.owned(this.path(name),e),sourcePresent:Boolean(stat(join(e.source,'SKILL.md')))})));}
  link(name:string,source:string):SkillLinkResult {
    const target=this.path(name);if(!isAbsolute(source))throw new Error('Skill 来源目录必须是绝对路径');source=resolve(source);
    const skill=stat(join(source,'SKILL.md'));if(!skill?.isFile()||skill.isSymbolicLink())throw new Error('Skill 来源缺少普通 SKILL.md 文件');
    const physicalSource=realpathSync(source);if(inside(physicalSource,this.root))throw new Error('不能在 Skill 来源目录内写纳管记录');
    return this.locked(journal=>{
      const previous=Object.hasOwn(journal.entries,name)?journal.entries[name]:undefined,existing=stat(target);
      if(previous){
        if(previous.source!==source)throw new Error('同名 Skill 已纳管自另一来源');
        if(existing&&!this.owned(target,previous))throw new Error('目标已被替换，保留用户内容');
        if(existing)return {state:'linked',target,source};
        // A missing owned target can be repaired; no differing target is removed.
      }else if(existing){
        try{if(realpathSync(target)===physicalSource)return {state:'native',target,source};}catch{/* dangling user links remain conflicts */}
        throw new Error('同名 Skill 目标已存在，保留原件');
      }
      // Exclusive symlink creation never overwrites a file created after inspection.
      symlinkSync(source,target,'dir');const created=lstatSync(target);
      const old=Object.hasOwn(journal.entries,name)?journal.entries[name]:undefined;journal.entries[name]={source,inode:created.ino,device:created.dev};
      try{this.write(journal);}catch(e){
        // Roll back only the exact link just created; a replacement is held.
        if(this.owned(target,journal.entries[name]))this.removeExact(target,journal.entries[name]);if(old)journal.entries[name]=old;else delete journal.entries[name];throw e;
      }
      return {state:'linked',target,source};
    });
  }
  remove(name:string):boolean {
    const target=this.path(name);return this.locked(journal=>{
      const entry=Object.hasOwn(journal.entries,name)?journal.entries[name]:undefined;if(!entry)return false;
      const existing=stat(target);if(existing&&!this.owned(target,entry))throw new Error('目标已被替换，取消纳管不会删除用户内容');
      if(existing)this.removeExact(target,entry);delete journal.entries[name];this.write(journal);return true;
    });
  }
  cleanupMissingSources():{removed:string[];held:string[]} {
    return this.locked(journal=>{
      const removed:string[]=[],held:string[]=[];
      for(const [name,entry] of Object.entries(journal.entries)){
        const target=this.path(name);if(stat(join(entry.source,'SKILL.md'))?.isFile())continue;
        if(stat(target)&&!this.owned(target,entry)){held.push(name);continue;}
        if(stat(target))this.removeExact(target,entry);delete journal.entries[name];removed.push(name);
      }
      if(removed.length)this.write(journal);return {removed,held};
    });
  }
  /** An empty project journal should not leave an untracked repository file. */
  pruneEmptyJournal():void {
    this.locked(journal=>{
      if(Object.keys(journal.entries).length)return;
      const path=join(this.root,'.willyou-managed.json'),before=stat(path);if(!before)return;
      const bytes=readFileSync(path),held=path+'.held-'+randomUUID();renameSync(path,held);
      const claimed=stat(held);
      if(claimed?.isFile()&&!claimed.isSymbolicLink()&&claimed.ino===before.ino&&claimed.dev===before.dev&&readFileSync(held).equals(bytes)){rmSync(held);return;}
      try{linkSync(held,path);rmSync(held);}catch{throw new Error(`纳管记录已被替换，原件保留在 ${held}`);}
      throw new Error('纳管记录已被替换，已保留原件');
    });
  }
}
