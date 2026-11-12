import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ApplicationError} from '@shared/applications';
import {libraryName,syncAgentSkillLibrary,type AgentSkillTarget,type LibrarySkill,type LibrarySyncResult} from './agent-skill-library';
import {libraryFrontMatter,renderLibrarySkill} from './application-skill-template';
import type {BuiltinPackageRegistry} from './builtin-package-registry';
import {digest} from './manifest';
import {builtinApplicationModules} from './modules';
import {verifyPackageTree} from './package-files';
import type {ResourceStore} from './resource-store';
import {hasExternalPluginOwner} from './plugins/legacy-routing';

/**
 * R16: one library copy per application Skill, for every application the user has added and enabled,
 * rendered from its active package. Project enablement is not a delivery question; the host decides each call (R17).
 */
export class SkillLibraryService {
  private last:LibrarySyncResult|null=null;
  constructor(private readonly store:ResourceStore,private readonly builtin:Pick<BuiltinPackageRegistry,'packages'>,private readonly options:{home:string;targets:()=>readonly AgentSkillTarget[];added:(appId:string)=>boolean;
    /** Active bundled standard Skills (2026-11-04: in the library for every session, no per-project switch). */
    standardSkills?:()=>readonly {skillId:string;files:Readonly<Record<string,Buffer>>}[];modules?:Pick<typeof builtinApplicationModules,'appIds'>}){}

  skills():LibrarySkill[]{
    const result:LibrarySkill[]=[];
    for(const appId of (this.options.modules??builtinApplicationModules).appIds()){
      if(!this.options.added(appId)||hasExternalPluginOwner(this.store.sqlite,appId))continue;
      const active=this.builtin.packages.active(appId);if(!active)continue;
      const installed=this.builtin.packages.get(active.packageHash),root=join(this.store.root,installed.relativePath);
      verifyPackageTree(root,installed,this.store.storeId);
      for(const skill of installed.manifest.skills){
        const name=libraryName(appId,skill.id),prefix=skill.path+'/',files:Record<string,Buffer>={},executables=new Set<string>();
        for(const source of installed.manifest.files.filter(f=>f.path.startsWith(prefix))){
          const relative=source.path.slice(prefix.length),bytes=readFileSync(join(root,source.path));
          if(bytes.length!==source.size||digest(bytes)!==source.sha256)throw new ApplicationError('HASH_MISMATCH','应用Skill文件在读取时已改变');
          files[relative]=relative==='SKILL.md'?renderLibrarySkill(bytes,installed.manifest,skill.id,name):bytes;if(source.executable)executables.add(relative);
        }
        if(!files['SKILL.md'])throw new ApplicationError('INVALID_PACKAGE','应用Skill缺少入口');
        result.push({name,files,executables});
      }
    }
    for(const standard of this.options.standardSkills?.()??[]){
      const name=libraryName(undefined,standard.skillId),files={...standard.files};
      if(!files['SKILL.md'])throw new ApplicationError('INVALID_PACKAGE','标准Skill缺少入口');
      files['SKILL.md']=libraryFrontMatter(files['SKILL.md'],name);result.push({name,files,executables:new Set()});
    }
    return result;
  }

  /** Idempotent: unchanged copies are not rewritten. Synchronous, so calls never interleave. */
  sync():LibrarySyncResult{
    this.last=syncAgentSkillLibrary({home:this.options.home,targets:this.options.targets(),skills:this.skills()});
    return this.last;
  }
  /** Names another owner already holds; shown on the application page instead of overwriting. */
  conflicts(){return this.last?.conflicts??[];}
}
