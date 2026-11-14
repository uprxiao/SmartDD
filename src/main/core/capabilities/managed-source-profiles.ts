import type { AiProfileView } from '@shared/ai-profiles';
import type { ProviderView, RunConfigView } from '@shared/ai-agents';
import { CLAUDE_MODEL_VARIABLES, managedClaudeRoot } from '../ai/agent-launch-plan';

/** Public discovery contexts must include the actual state directory used by
 * normal Agents, not just the old profile table's originally empty env array.
 * Secret names are references only; no key lookup or CLI execution occurs. */
export function managedSourceProfiles(userData:string,profiles:AiProfileView[],configs:RunConfigView[],providers:ProviderView[]):AiProfileView[]{
  return profiles.map(profile=>{
    const config=configs.find(x=>x.id===profile.id);
    if(config?.source!=='provider')return profile;
    const provider=providers.find(x=>x.id===config.providerId);if(!provider)return profile;
    const env:AiProfileView['env']=profile.env.filter(x=>['MAX_THINKING_TOKENS','CLAUDE_CODE_MAX_OUTPUT_TOKENS','API_TIMEOUT_MS'].includes(x.name));
    const add=(name:string,value:string|null,secret=false)=>env.push({name,value,secret,hasValue:value!==null||secret});
    if(config.kind==='claude'){
      add('CLAUDE_CONFIG_DIR',managedClaudeRoot(userData,config.id));
      if(provider.endpoints.anthropic)add('ANTHROPIC_BASE_URL',provider.endpoints.anthropic);
      add(provider.authType==='api-key'?'ANTHROPIC_API_KEY':'ANTHROPIC_AUTH_TOKEN',null,true);
      if(config.defaultModel)for(const name of CLAUDE_MODEL_VARIABLES)add(name,config.defaultModel);
    }else add('OPENAI_API_KEY',null,true);
    return {...profile,args:[],env};
  });
}
