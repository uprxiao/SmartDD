import budget from '@shared/file-watch-budget.json';

export { budget as fileWatchBudget };

/** Shared-root wall-time duty budget, including event-triggered background scans. */
export function watchScanCooldown(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < budget.minMeasuredDurationMs) return 0;
  return Math.min(budget.maxPollIntervalMs, Math.ceil(elapsedMs / budget.targetWallDutyFraction - elapsedMs));
}

export function watchScanCostMessage(elapsedMs: number): string | undefined {
  return elapsedMs > budget.softScanWarningMs
    ? `目录补扫耗时 ${Math.ceil(elapsedMs)}ms，超过 ${budget.softScanWarningMs}ms 成本预算，已降低后台扫描频率`
    : undefined;
}
