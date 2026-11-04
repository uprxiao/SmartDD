import { describe, expect, it } from 'vitest';
import { builtinCapabilityDeliveryAdapters, CapabilityDeliveryAdapterRegistry, type CapabilityDeliveryAdapter } from '../capability-delivery-adapters';

describe('agent adapters declare how they find WillYou skills and when changes reach a running session', () => {
  it('records the measured Codex 0.166.0 and Claude Code 2.1.318 behaviour', () => {
    expect(builtinCapabilityDeliveryAdapters.libraryTargets()).toEqual([
      { agentId: 'claude-code', readsSharedAgentSkills: false, skillDirectory: '.claude/skills' },
      { agentId: 'codex', readsSharedAgentSkills: true },
    ]);
    expect(builtinCapabilityDeliveryAdapters.get('codex').library).toEqual({ readsSharedAgentSkills: true, resumable: true, skillsReloadInSession: true, mcpReloadInSession: false });
    expect(builtinCapabilityDeliveryAdapters.get('claude-code').library).toEqual({ readsSharedAgentSkills: false, skillDirectory: '.claude/skills', resumable: true, skillsReloadInSession: false, mcpReloadInSession: true });
  });
  it('rejects an agent that neither reads the shared directory nor names a relative skill directory', () => {
    const base = builtinCapabilityDeliveryAdapters.get('claude-code');
    const variant = (library: CapabilityDeliveryAdapter['library']) => ({ ...base, id: 'third-agent', runnerId: 'third', library });
    expect(() => new CapabilityDeliveryAdapterRegistry([variant({ readsSharedAgentSkills: false, resumable: true, skillsReloadInSession: false, mcpReloadInSession: false })])).toThrow('Skill');
    expect(() => new CapabilityDeliveryAdapterRegistry([variant({ readsSharedAgentSkills: false, skillDirectory: '/abs/skills', resumable: true, skillsReloadInSession: false, mcpReloadInSession: false })])).toThrow('Skill');
  });
});
