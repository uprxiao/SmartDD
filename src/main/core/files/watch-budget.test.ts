import { describe, expect, it } from 'vitest';
import { fileWatchBudget as budget, watchScanCooldown, watchScanCostMessage } from './watch-budget';

describe('frozen shared-root watch scheduling budget', () => {
  it('does not treat submillisecond or invalid timing samples as measured IO', () => {
    for (const elapsed of [NaN, Infinity, -1, 0, 0.99]) expect(watchScanCooldown(elapsed)).toBe(0);
  });
  it('keeps measured scheduling duty within the frozen fraction up to the idle cap', () => {
    for (const elapsed of [1, 9, 100, 199, 200, 201, 1000]) {
      const idle = watchScanCooldown(elapsed);
      expect(elapsed / (elapsed + idle)).toBeLessThanOrEqual(budget.targetWallDutyFraction);
    }
    expect(watchScanCooldown(100000)).toBe(budget.maxPollIntervalMs);
  });
  it('shows a cost warning only beyond the soft threshold and clears it after recovery', () => {
    expect(watchScanCostMessage(budget.softScanWarningMs)).toBeUndefined();
    expect(watchScanCostMessage(budget.softScanWarningMs + 1)).toContain('降低后台扫描频率');
    expect(watchScanCostMessage(100)).toBeUndefined();
  });
});
