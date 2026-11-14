import { expect, it } from 'vitest';
import type { AgentSourceIdentity } from '@shared/agent-run-state';
import type { ProviderView, RunConfigView } from '@shared/ai-agents';
import { assertResumeSource, lastRequestedModel, resumeModel } from './agent-run-state';

const identity: AgentSourceIdentity = { configId: 'c', toolId: 'claude', kind: 'claude', source: 'provider', providerId: 'p', providerRevision: 1, login: null };
it.each([
  { providerRevision: 2 }, { providerId: 'p2' }, { source: 'login' as const, providerId: null, providerRevision: null, login: 'api' as const },
  { configId: 'another' }, { toolId: 'another' },
])('requires explicit reselection for changed authentication identity %j', (change) => {
  const next = { ...identity, ...change };
  expect(() => assertResumeSource(identity, next, false)).toThrow('来源已变化');
  expect(() => assertResumeSource(identity, next, true)).not.toThrow();
});
it('retains same identity and never permits cross-native-engine restore even with explicit selection', () => {
  expect(() => assertResumeSource(identity, { ...identity }, false)).not.toThrow();
  expect(() => assertResumeSource(identity, { ...identity, kind: 'codex' }, true)).toThrow('同一个 Code Agent');
});
it('detects CLI subscription/API changes independently of Provider revisions', () => {
  const login = { ...identity, source: 'login' as const, providerId: null, providerRevision: null, login: 'subscription' as const };
  expect(() => assertResumeSource(login, { ...login, login: 'api' }, false)).toThrow('来源已变化');
});
it('reads only main-thread requestedModel, ignoring response aliases, sidechains, errors and text decoys', () => {
  expect(lastRequestedModel('claude', [
    { type: 'assistant', requestedModel: 'before' }, { type: 'assistant', requestedModel: 'last', message: { model: 'response-alias' } },
    { type: 'assistant', isSidechain: true, requestedModel: 'subagent' },
    { type: 'assistant', isApiErrorMessage: true, requestedModel: 'failed' },
    { type: 'attachment', attachment: { identity: { modelId: 'fallback' } } },
    { type: 'user', message: { requestedModel: 'content-decoy' } },
  ])).toBe('last');
  expect(lastRequestedModel('claude', [{ type: 'attachment', attachment: { identity: { modelId: 'fallback' } } }])).toBe('fallback');
});
it('uses the last Codex turn_context model and refuses arbitrary assistant/result content', () => {
  expect(lastRequestedModel('codex', [{ type: 'turn_context', payload: { model: 'before' } }, { type: 'turn_context', payload: { model: 'last' } }, { type: 'response_item', payload: { model: 'not-native-context' } }])).toBe('last');
  expect(lastRequestedModel('codex', [{ type: 'turn_context', payload: { model: '--bad' } }])).toBeNull();
});
it('preserves an allowed last model despite a changed default and explicitly reports fallback decisions', () => {
  const config = { kind: 'claude', source: 'provider', providerId: 'p', models: ['a','b'], defaultModel: 'a' } as RunConfigView;
  const provider = { id: 'p', models: ['a','b'].map((id) => ({ id, offline: false, availability: { claude: 'untested', codex: 'untested' } })) } as ProviderView;
  expect(resumeModel(config, provider, 'b')).toEqual({ model: 'b', changed: false, reason: null });
  expect(resumeModel(config, provider, 'gone')).toMatchObject({ model: 'a', changed: true });
  expect(resumeModel(config, provider, null)).toMatchObject({ model: 'a', changed: true });
  provider.models[0].offline = true; expect(() => resumeModel(config, provider, 'gone')).toThrow('默认模型已下线');
});
