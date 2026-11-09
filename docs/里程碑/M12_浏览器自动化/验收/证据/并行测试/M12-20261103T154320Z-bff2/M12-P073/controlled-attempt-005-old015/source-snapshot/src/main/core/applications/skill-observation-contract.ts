import type { SkillReadObservation, SkillReadTarget } from './codex-skill-read-evidence';

/** Shared by live host reads and compatibility probes. A parser cannot certify
 * a shape that the live host would discard or expose extra native content. */
export function validSkillObservations(value: unknown, targets: readonly SkillReadTarget[], since: number, through: number): value is SkillReadObservation[] {
  return Array.isArray(value) && value.length <= targets.length && new Set(value.map(o => o?.skillId)).size === value.length && !value.some(o => !o || Object.keys(o).some(key => !['skillId','observedAt','callId','recordHash'].includes(key)) || !targets.some(t => t.id === o.skillId) || typeof o.callId !== 'string' || !o.callId || o.callId.length > 512 || typeof o.recordHash !== 'string' || !/^[a-f0-9]{64}$/.test(o.recordHash) || !Number.isFinite(Date.parse(o.observedAt)) || Date.parse(o.observedAt) < since || Date.parse(o.observedAt) > through);
}
