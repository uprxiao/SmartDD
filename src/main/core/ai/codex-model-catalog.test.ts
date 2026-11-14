import { expect, it } from 'vitest';
import type { ProviderModel } from '@shared/ai-agents';
import { buildCodexModelCatalog, CODEX_CATALOG_BASE_INSTRUCTIONS } from './codex-model-catalog';

const model = (id: string): ProviderModel => ({ id, name: id, contextWindow: null, offline: false, availability: { claude: 'untested', codex: 'untested' } });
it('includes only selected model identities in stable order, with safe generic metadata', () => {
  const result = buildCodexModelCatalog([model('a'), model('b'), model('c')], ['b', 'a', 'b']);
  expect(result.models.map((item) => item.slug)).toEqual(['b', 'a']);
  expect(result.models[0]).toMatchObject({ context_window: 128000, input_modalities: ['text'], priority: 0 });
  expect(result.models[0].base_instructions).toBe(CODEX_CATALOG_BASE_INSTRUCTIONS);
  expect(result.models[0]).not.toHaveProperty('model_messages'); expect(result.models[0]).not.toHaveProperty('guardian');
});
it('retains validated model context/modalities/reasoning but not unrelated remote instructions', () => {
  const supplied = { ...model('a'), contextWindow: 200000, codex: { reasoningLevels: ['low', 'high'], defaultReasoning: 'high', inputModalities: ['text', 'image'] as ('text' | 'image')[], supportVerbosity: true }, model_messages: { instructions_template: 'NOT_COPIED' } };
  const result = buildCodexModelCatalog([supplied], ['a']);
  expect(result.models[0]).toMatchObject({ context_window: 200000, default_reasoning_level: 'high', input_modalities: ['text', 'image'], support_verbosity: true });
  expect(JSON.stringify(result)).not.toContain('NOT_COPIED');
});
it('does not silently substitute a different model if a selected identity is offline/missing/unavailable', () => {
  expect(() => buildCodexModelCatalog([{ ...model('a'), offline: true }], ['a'])).toThrow('已不可用');
  expect(() => buildCodexModelCatalog([model('a')], ['b'])).toThrow('已不可用');
  expect(() => buildCodexModelCatalog([{ ...model('a'), availability: { claude: 'available', codex: 'unavailable' } }], ['a'])).toThrow('已不可用');
});
