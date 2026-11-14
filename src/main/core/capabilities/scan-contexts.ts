import { join } from 'node:path';
import type { AiProfileView } from '@shared/ai-profiles';
import type { CapabilityScanContext } from './capability-registry';

/** Discovery uses paths and public profile fields, never profile.resolve(), auth
 * helpers or the secret store. Native CLI installation is a separate concern. */
export function capabilityScanContexts(home:string,base:Record<string,string>,profiles:(Pick<AiProfileView,'runner'|'args'>&{id?:string;env:Pick<AiProfileView['env'][number],'name'|'secret'|'value'>[]})[],projectRoots:string[]):CapabilityScanContext[]{
  const variants=[{runner:'claude' as const,env:[],args:[] as string[]},{runner:'codex' as const,env:[],args:[] as string[]},...profiles];
  const seen=new Set<string>(),result:CapabilityScanContext[]=[];
  for(const profile of variants){
    if(profile.runner!=='claude'&&profile.runner!=='codex')continue;
    const env={...base,...Object.fromEntries(profile.env.filter(x=>!x.secret&&x.value!==null).map(x=>[x.name,x.value!]))};
    const actualHome=env.HOME||home;
    const stateRoot=profile.runner==='codex'?env.CODEX_HOME||join(actualHome,'.codex'):env.CLAUDE_CONFIG_DIR||join(actualHome,'.claude');
    for(const cwd of [actualHome,...projectRoots]){
      const configurationId='id'in profile?profile.id:undefined;
      const secretEnvNames=profile.env.filter(x=>x.secret).map(x=>x.name);
      const key=JSON.stringify([profile.runner,actualHome,stateRoot,cwd,profile.args,configurationId,env,secretEnvNames]);if(seen.has(key))continue;seen.add(key);
      result.push({runner:profile.runner,home:actualHome,stateRoot,cwd,path:env.PATH??'',args:profile.args,sourceEnvironment:env,secretEnvNames,claudeConfigExplicit:Boolean(env.CLAUDE_CONFIG_DIR),...(configurationId?{configurationId}:{}),...(cwd!==actualHome?{projectRoot:cwd}:{})});
    }
  }
  return result;
}
