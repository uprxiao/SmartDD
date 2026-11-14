import type { CodeAgentKind, ProviderView } from './ai-agents';

/** Protocol identities already verified in M13 research. Editing a preset URL
 * makes it a custom connection for confirmation purposes, regardless of label.
 * SMG's local endpoint is supplied separately; GLM/UltraCloud remain unverified.
 */
const verified: Record<string, Partial<Record<CodeAgentKind, string>>> = {
  anthropic: { claude: 'https://api.anthropic.com/' },
  openai: { codex: 'https://api.openai.com/v1' },
  deepseek: { claude: 'https://api.deepseek.com/anthropic', codex: 'https://api.deepseek.com/' },
  magpie: { claude: 'http://127.0.0.1:3425/', codex: 'http://127.0.0.1:3425/v1' },
};

export function verifiedPresetProtocol(preset: string | null, endpoints: ProviderView['endpoints'], kind: CodeAgentKind): boolean {
  const expected = preset ? verified[preset]?.[kind] : undefined;
  const actual = kind === 'claude' ? endpoints.anthropic : endpoints.responses;
  if (!expected || !actual) return false;
  return new URL(actual).toString().replace(/\/$/, '') === expected.replace(/\/$/, '');
}

export const publicLocalMagpie = (preset:string|null,endpoints:ProviderView['endpoints']) =>
  preset==='magpie'&&(['codex','claude'] as const).some(kind=>verifiedPresetProtocol(preset,endpoints,kind));
