import type { ProviderModel } from './ai-agents';

export interface ProviderCatalogModel extends ProviderModel {
  vendor?: string;
  purpose?: 'conversation' | 'image' | 'video' | 'audio' | 'embedding';
}

export function modelForStorage({ vendor: _vendor, purpose: _purpose, ...model }: ProviderCatalogModel): ProviderModel {
  return model;
}

// Some gateways put a model family in owned_by. Normalize known aliases so
// the manufacturer's models share a filter, including non-chat models.
const families = [
  { vendor: 'OpenAI', owners: ['openai', 'open ai'], ids: /^(?:gpt(?:[-.]|\d)|o[134](?:-|$)|dall-e(?:-|$)|sora(?:-|$)|whisper(?:-|$)|text-embedding-)/ },
  { vendor: 'Anthropic', owners: ['anthropic', 'claude'], ids: /^claude(?:-|$)/ },
  { vendor: 'Google', owners: ['google', 'gemini', 'google deepmind', 'deepmind'], ids: /^(?:gemini|imagen|veo)(?:[-.]|\d)/ },
  { vendor: '阿里云', owners: ['阿里云', '阿里巴巴', 'alibaba', 'alibaba cloud', 'dashscope', '千问万相', '通义千问', 'qwen', 'wan'], ids: /^(?:qwen|qwq|wan)(?:[-.]|\d)|^fun-asr(?:-|$)/ },
  { vendor: '智谱', owners: ['智谱', '智谱ai', 'zhipu', 'zhipu ai', 'z.ai', 'glm'], ids: /^glm(?:[-.]|\d)/ },
  { vendor: 'DeepSeek', owners: ['deepseek'], ids: /^deepseek(?:[-.]|\d)/ },
  { vendor: 'MiniMax', owners: ['minimax'], ids: /^(?:minimax|abab|hailuo)(?:[-.]|\d)/ },
  { vendor: 'Moonshot AI', owners: ['moonshot', 'moonshot ai', 'kimi', '月之暗面'], ids: /^(?:kimi|moonshot)(?:[-.]|\d)/ },
  { vendor: 'xAI', owners: ['xai', 'grok'], ids: /^grok(?:[-.]|\d)/ },
  { vendor: '字节跳动', owners: ['字节跳动', 'bytedance', '豆包', 'doubao'], ids: /^(?:doubao|seedance|seedream)(?:[-.]|\d)/ },
  { vendor: 'Vidu', owners: ['vidu'], ids: /^vidu(?:[-q.]|\d)/ },
];
const placeholderOwner = /^(?:system|user|unknown|default|local|custom|self-hosted|openai[- ]compatible|model[- ]hub|gateway|other|其他|未知|未分类|-)$/i;

type Purpose = NonNullable<ProviderCatalogModel['purpose']>;
const declaredPurposes: Record<string, Purpose> = {
  llm: 'conversation', chat: 'conversation', completion: 'conversation', 'chat-completion': 'conversation', 'text-generation': 'conversation', 'text': 'conversation',
  image: 'image', 'image-generation': 'image', t2i: 'image', i2i: 'image',
  video: 'video', 'video-generation': 'video', t2v: 'video', i2v: 'video', r2v: 'video',
  audio: 'audio', asr: 'audio', tts: 'audio', t2a: 'audio', stt: 'audio', speech: 'audio', transcription: 'audio',
  embedding: 'embedding', embeddings: 'embedding', rerank: 'embedding',
};

const specializedFamilies: ReadonlyArray<[RegExp, Purpose]> = [
  [/^(?:sora|veo|seedance)(?:[-.]|\d)|^vidu(?:[-q.]|\d)|^wan(?:[-.]|\d).*(?:video|-(?:i2v|t2v|r2v)(?:-|$))/,'video'],
  [/^(?:gpt-image|dall-e|imagen|seedream|flux|nano-banana)(?:[-.]|\d|$)|^gemini-(?:nano-banana(?:-|$)|.*-image(?:-|$))|^wan(?:[-.]|\d).*(?:image|-(?:i2i|t2i)(?:-|$))/,'image'],
  [/^(?:whisper|fun-asr|speech|cosyvoice)(?:[-.]|\d|$)|^(?:gpt|qwen)(?:[-.]|\d).*-(?:tts|transcribe|asr)(?:-|$)/,'audio'],
  [/^text-embedding-|^(?:qwen|glm|bge)[\w.-]*-(?:embedding|rerank)(?:-|$)/,'embedding'],
];
const conversationFamily = /^(?:gpt(?:[-.]|\d)|o[134](?:-|$)|(?:claude|gemini|qwen|qwq|glm|deepseek|grok|kimi|moonshot|doubao|llama|mistral|mixtral)(?:[-.]|\d))/;

export function providerModelMetadata(row: Record<string, unknown>, id: string): Pick<ProviderCatalogModel, 'vendor' | 'purpose'> {
  const familyId = id.toLowerCase().split('/').at(-1)!;
  const inferred = families.find(family => family.ids.test(familyId))?.vendor;
  const declared = [row.manufacturer, row.vendor, row.owned_by].find((value): value is string =>
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100 &&
    !/[\u0000-\u001f\u007f]/.test(value) && !placeholderOwner.test(value.trim()))?.trim();
  const normalized = declared && (families.find(family => family.owners.includes(declared.toLowerCase()))?.vendor ?? declared);
  const vendor = normalized && inferred && normalized.toLowerCase() !== inferred.toLowerCase() ? undefined : normalized || inferred;

  const text = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase().replace(/[ _]+/g, '-') : '';
  const type = [row.model_type, row.type].map(text)
    .map(value => Object.hasOwn(declaredPurposes, value) ? declaredPurposes[value] : undefined)
    .find(Boolean);
  const outputs = Array.isArray(row.output_modalities) ? row.output_modalities.map(text) : [];
  const output = outputs.includes('text') ? 'conversation' : (['video', 'image', 'audio', 'embedding'] as const).find(value => outputs.includes(value));
  const specialized = specializedFamilies.find(([pattern]) => pattern.test(familyId))?.[1];
  const purpose = output ?? (type && type !== 'conversation' ? type : specialized ?? type) ??
    (conversationFamily.test(familyId) ? 'conversation' : undefined);
  return { ...(vendor ? { vendor } : {}), ...(purpose ? { purpose } : {}) };
}
