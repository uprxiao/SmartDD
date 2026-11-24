import type { AiProfileView } from '@shared/ai-profiles';
import type { CapabilityScanContext } from './capability-registry';
import { skillAdapter, skillAdapters } from './skill-adapters';

/** Discovery uses paths and public profile fields, never profile.resolve(), auth
 * helpers or the secret store. Native CLI installation is a separate concern. */
export function capabilityScanContexts(home:string,base:Record<string,string>,profiles:(Pick<AiProfileView,'runner'|'args'>&{id?:string;env:Pick<AiProfileView['env'][number],'name'|'secret'|'value'>[]})[],projectRoots:string[]):CapabilityScanContext[]{
  const variants=[...skillAdapters.map(({ runner }) => ({ runner, env: [], args: [] as string[] })), ...profiles];
  const seen=new Set<string>(),result:CapabilityScanContext[]=[];
  for(const profile of variants){
    const adapter = skillAdapter(profile.runner);
    if (!adapter) continue;
    const env={...base,...Object.fromEntries(profile.env.filter(x=>!x.secret&&x.value!==null).map(x=>[x.name,x.value!]))};
    const actualHome=env.HOME||home;
    const stateRoot = adapter.stateRoot(actualHome, env);
    for(const cwd of [actualHome,...projectRoots]){
      const configurationId='id'in profile?profile.id:undefined;
      const secretEnvNames=profile.env.filter(x=>x.secret).map(x=>x.name);
      const key=JSON.stringify([profile.runner,actualHome,stateRoot,cwd,profile.args,configurationId,env,secretEnvNames]);if(seen.has(key))continue;seen.add(key);
      result.push({runner:profile.runner,home:actualHome,stateRoot,cwd,path:env.PATH??'',args:profile.args,sourceEnvironment:env,secretEnvNames,claudeConfigExplicit:Boolean(env.CLAUDE_CONFIG_DIR),...(configurationId?{configurationId}:{}),...(cwd!==actualHome?{projectRoot:cwd}:{})});
    }
  }
  return result;
}
