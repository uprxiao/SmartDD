import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import type { AppDb } from '../../db/client';
import { capabilitySkillPlacements } from '../../db/schema';
import type { Runner } from '@shared/types';
import type { CapabilityRegistryService } from './capability-registry';
import { ManagedSkillLinks } from './managed-skill-links';
import { projectLayers } from './discovery';

const canonical=(path:string)=>{try{return realpathSync(path);}catch{return resolve(path);}};
const present=(path:string)=>{try{return lstatSync(path);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}};
export interface SkillProjectionInput {runner:Runner;home:string;stateRoot:string;cwd:string;runRoot:string;nativeLogin:boolean}
export interface SkillProjectionResult {args:string[];configured:string[];issues:{id:string;reason:string}[]}

/** R03 placement: source is never written, Claude native login only receives an
 * owned per-run plugin, and project capabilities never enter a shared root. */
export class SkillProjectionService {
  constructor(private readonly db:AppDb,private readonly registry:CapabilityRegistryService){}
  prepare(input:SkillProjectionInput):SkillProjectionResult {
    const result:SkillProjectionResult={args:[],configured:[],issues:[]};let plugin=false;
    for(const item of this.registry.selected(input.cwd).filter(x=>x.kind==='skill')){
      try{
        if(input.runner==='claude'&&input.nativeLogin&&!item.projectRoot&&canonical(dirname(item.sourcePath))===canonical(join(input.stateRoot,'skills',item.name))){result.configured.push(item.id);continue;}
        const perRun=input.runner==='claude'&&(input.nativeLogin||Boolean(item.projectRoot));
        const root=input.runner==='codex'?join(item.projectRoot??input.home,'.agents/skills'):perRun?join(input.runRoot,'willyou-run/skills'):join(input.stateRoot,'skills');
        if(input.runner==='codex'){
          const roots=[join(input.home,'.agents/skills'),join(input.stateRoot,'skills'),'/etc/codex/skills',...projectLayers(input.cwd,input.home).map(p=>join(p,'.agents/skills'))];
          for(const other of roots){
            const target=join(other,item.name);if(canonical(other)===canonical(root)||!present(target))continue;
            if(canonical(target)!==canonical(dirname(item.sourcePath)))throw new Error('其他 Codex 加载目录存在同名 Skill，保留原件');
          }
        }
        if(item.projectRoot&&input.runner==='codex'&&this.tracked(item.projectRoot,join(root,item.name)))throw new Error('目标路径已被 Git 跟踪，保留原件');
        const links=new ManagedSkillLinks(root),linked=links.link(item.name,dirname(item.sourcePath));
        if(linked.state==='linked'&&!perRun){
          const id=createHash('sha256').update(JSON.stringify([canonical(root),item.name])).digest('hex');
          this.db.insert(capabilitySkillPlacements).values({id,capabilityId:item.id,targetRoot:root,name:item.name,projectRoot:input.runner==='codex'?item.projectRoot:null})
            .onConflictDoUpdate({target:capabilitySkillPlacements.id,set:{capabilityId:item.id}}).run();
          if(item.projectRoot&&input.runner==='codex'&&!this.exclude(item.projectRoot,linked.target,id,true))result.issues.push({id:item.id,reason:'当前项目不是 Git 仓库；本方链接会出现在项目目录'});
        }
        if(perRun)plugin=true;result.configured.push(item.id);
      }catch(error){result.issues.push({id:item.id,reason:error instanceof Error?error.message:'Skill 配置失败'});}
    }
    if(plugin){const root=join(input.runRoot,'willyou-run');mkdirSync(join(root,'.claude-plugin'),{recursive:true,mode:0o700});writeFileSync(join(root,'.claude-plugin/plugin.json'),JSON.stringify({name:'willyou-run',version:'1.0.0'}),{flag:'wx',mode:0o600});result.args.push('--plugin-dir',root);}
    return result;
  }
  revoke(id:string):void {
    for(const placement of this.db.select().from(capabilitySkillPlacements).where(eq(capabilitySkillPlacements.capabilityId,id)).all()){
      const links=new ManagedSkillLinks(placement.targetRoot);links.remove(placement.name);links.pruneEmptyJournal();
      if(placement.projectRoot)this.exclude(placement.projectRoot,join(placement.targetRoot,placement.name),placement.id,false);
      this.db.delete(capabilitySkillPlacements).where(eq(capabilitySkillPlacements.id,placement.id)).run();
    }
  }
  reconcileSources():void {
    for(const item of this.registry.list().items)if(!['host','plugin'].includes(item.sourceScope)&&(item.status==='missing'||item.status==='invalid'||!item.managed||!item.enabled))this.revoke(item.id);
  }
  private git(root:string,args:string[]){return spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:5000,maxBuffer:128*1024,env:{PATH:process.env.PATH??'/usr/bin:/bin',HOME:root,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_OPTIONAL_LOCKS:'0'}});}
  private tracked(root:string,path:string):boolean {return this.git(root,['ls-files','--error-unmatch','--',relative(root,path)]).status===0;}
  private exclude(root:string,target:string,id:string,add:boolean):boolean {
    const git=this.git(root,['rev-parse','--git-path','info/exclude']);if(git.status!==0)return false;
    const path=resolve(root,git.stdout.trim()),stat=present(path);if(stat&&(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024))throw new Error('Git exclude 文件不可安全修改');
    const before=stat?readFileSync(path,'utf8'):'';
    const rel=relative(root,target).split('\\').join('/');if(rel.startsWith('../')||/[\r\n]/.test(rel))throw new Error('Git 排除路径无效');
    const journal=relative(root,join(dirname(target),'.willyou-managed.json')).split('\\').join('/');
    const escape=(s:string)=>s.replace(/[\\!*?\[\]# ]/g,'\\$&');
    const block=`# WillYou managed ${id}\n/${escape(rel)}\n/${escape(journal)}\n`;
    const without=before.replace(block,'');const after=add?without+(without&&!without.endsWith('\n')?'\n':'')+block:without;if(after===before)return true;
    mkdirSync(dirname(path),{recursive:true});const temp=path+'.willyou-'+randomUUID();
    try{writeFileSync(temp,after,{flag:'wx',mode:stat?.mode??0o600});if((existsSync(path)?readFileSync(path,'utf8'):'')!==before)throw new Error('Git exclude 已被其他程序修改，请重试');renameSync(temp,path);}finally{rmSync(temp,{force:true});}
    return true;
  }
}
