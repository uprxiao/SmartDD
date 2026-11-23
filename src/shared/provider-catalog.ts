import type { CodeAgentKind, ProviderModel, ProviderView } from './ai-agents';

export interface ProviderPreset {
  id:string;name:string;description:string;keyLabel:string;authType:ProviderView['authType'];
  endpoints:Partial<ProviderView['endpoints']>;tools:CodeAgentKind[];requiresAddress?:boolean;documented:boolean;
  recommended:Partial<Record<CodeAgentKind,string>>;source:string;
}
export const modelHubEndpoints = {
  responses: 'https://rjmodel.rjupc.com/v1',
  anthropic: 'https://rjmodel.rjupc.com',
};
export const modelHubGeminiEndpoint = 'https://rjmodel.rjupc.com';
/** Directory descriptions are data, not claims that a user's Key/model works.
 * Model IDs shown in product come from the actual selected service. */
export const providerCatalog:ProviderPreset[]=[
  {id:'anthropic',name:'Anthropic',description:'官方 API',keyLabel:'Anthropic API Key',authType:'api-key',endpoints:{anthropic:'https://api.anthropic.com'},tools:['claude'],documented:true,recommended:{},source:'https://platform.claude.com/docs/en/api/models/list'},
  {id:'openai',name:'OpenAI',description:'官方 API',keyLabel:'OpenAI API Key',authType:'bearer',endpoints:{responses:'https://api.openai.com/v1'},tools:['codex'],documented:true,recommended:{},source:'https://developers.openai.com/api/reference/resources/models/methods/list'},
  {id:'deepseek',name:'DeepSeek',description:'官方 API',keyLabel:'DeepSeek API Key',authType:'bearer',endpoints:{responses:'https://api.deepseek.com/',anthropic:'https://api.deepseek.com/anthropic'},tools:['claude','codex'],documented:true,recommended:{claude:'deepseek-v4-pro',codex:'deepseek-v4-pro'},source:'https://api-docs.deepseek.com/quick_start/agent_integrations/codex/'},
  {id:'glm',name:'GLM（智谱）',description:'智谱开放平台',keyLabel:'智谱 API Key',authType:'bearer',endpoints:{anthropic:'https://open.bigmodel.cn/api/anthropic',openai:'https://open.bigmodel.cn/api/paas/v4'},tools:['claude'],documented:true,recommended:{},source:'https://docs.bigmodel.cn/cn/coding-plan/tool/claude'},
  {id:'smg',name:'SMG',description:'公司内网模型网关',keyLabel:'SMG API Key',authType:'bearer',endpoints:{},tools:['claude'],requiresAddress:true,documented:true,recommended:{claude:'deepseek-v4-pro'},source:'docs/里程碑/M13_应用Skill与MCP插件化重构/技研/补验D_智能体与供应商_20261111.md'},
  {id:'ultracloud',name:'Model Hub',description:'模型网关',keyLabel:'Model Hub Key',authType:'bearer',endpoints:{...modelHubEndpoints,gemini:modelHubGeminiEndpoint},tools:[],documented:true,recommended:{},source:'https://modelhub.ailemac.com/model/docs'},
  {id:'magpie',name:'Magpie',description:'本机网关，真实 Key 与路由留在 Magpie',keyLabel:'本机公开令牌',authType:'bearer',endpoints:{responses:'http://127.0.0.1:3425/v1',anthropic:'http://127.0.0.1:3425'},tools:['claude','codex'],documented:true,recommended:{},source:'../magpie/internal/gateway/{gateway.go,codex_catalog.go}'},
];

export function recommendedProviderModel(preset:string|null,models:ProviderModel[],kind:CodeAgentKind):string|undefined{
  const allowed=models.filter(m=>!m.offline&&m.availability[kind]!=='unavailable');
  const preferred=providerCatalog.find(p=>p.id===preset)?.recommended[kind];
  const modelHubFamily = preset === 'ultracloud'
    ? allowed.find(model => model.id.toLowerCase().startsWith(kind === 'claude' ? 'claude-' : kind === 'antigravity' ? 'gemini-' : 'gpt-'))
    : undefined;
  return (allowed.find(m=>m.id===preferred)??(preset==='smg'&&preferred?allowed.find(m=>m.id.startsWith(preferred)):undefined)
    ??allowed.find(m=>m.availability[kind]==='available')??modelHubFamily??allowed[0])?.id;
}
