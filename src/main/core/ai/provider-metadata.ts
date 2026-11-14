import type { ProviderModel, ProviderView } from '@shared/ai-agents';
import { verifiedPresetProtocol } from '@shared/ai-provider-presets';

/** Safe, declarative defaults from DeepSeek's Codex guide (checked 2026-11-12).
 * Only metadata is copied; remote prompt templates and policy overrides are not.
 * https://api-docs.deepseek.com/quick_start/agent_integrations/codex/
 */
export function presetModelMetadata(preset:string|null,endpoints:ProviderView['endpoints'],models:ProviderModel[]):ProviderModel[]{
  if(preset!=='deepseek'||!verifiedPresetProtocol(preset,endpoints,'codex'))return models;
  return models.map(m=>{
    if(!['deepseek-flash','deepseek-v4-pro'].includes(m.id))return m;
    return {...m,contextWindow:m.contextWindow??1048576,codex:{reasoningLevels:['low','high','max'],defaultReasoning:'high',
      ...(m.codex??{}),...(m.codex?.reasoningLevels.length?{}:{reasoningLevels:['low','high','max'],defaultReasoning:'high'}),
      // These two official preset declarations must not be overwritten by the
      // generic decoder's missing-field defaults (text-only / false).
      inputModalities:m.id==='deepseek-flash'?['text','image']:['text'],supportVerbosity:true}};
  });
}
