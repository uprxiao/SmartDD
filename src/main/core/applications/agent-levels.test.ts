import { describe, expect, it } from 'vitest';
import { effectiveLevels, raiseBySelfCheck } from './agent-levels';

describe('agent level degradation (M11 T24-T26 software part)', () => {
  it('undeclared version: best-effort L0.skill/L0.mcp only, no CLI, no L2/L3, unverified', () => {
    const e = effectiveLevels([]);
    expect(e.levels).toEqual(['L0.skill', 'L0.mcp']);
    expect(e.verified).toBe(false);
    expect(e.nativeSendEvidence).toBe(false);
  });
  it('declared L0+L1 adapter works without L2/L3 and sends fall back to page click', () => {
    const e = effectiveLevels(['L0.skill', 'L0.mcp', 'L0.cli', 'L1']);
    expect(e.verified).toBe(true);
    expect(e.levels).toContain('L0.cli');
    expect(e.nativeSendEvidence).toBe(false);
  });
  it('native send evidence needs both declared L2 and L3', () => {
    expect(effectiveLevels(['L0.skill', 'L1', 'L2']).nativeSendEvidence).toBe(false);
    expect(effectiveLevels(['L0.skill', 'L1', 'L2', 'L3']).nativeSendEvidence).toBe(true);
  });
  it('self-check never raises to L3 or enables native send evidence', () => {
    const e = raiseBySelfCheck(effectiveLevels([]), ['L1', 'L2', 'L3']);
    expect(e.levels).toContain('L2');
    expect(e.levels).not.toContain('L3');
    expect(e.nativeSendEvidence).toBe(false);
    expect(e.verified).toBe(false);
  });
});
