import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { NativeEvidenceAdapter, NativeEvidenceIdentity } from './native-evidence-adapters';
import type { SkillReadTarget } from './codex-skill-read-evidence';
import type { ResourceStore } from './resource-store';
import { canonicalJson, digest } from './manifest';

/** Host-only compatibility probes, never an authorization source or a package RPC.
 * Log fixtures can prove only L2. CLI delivery still requires a separately
 * published entry/identity/sandbox contract; parsing user text cannot prove L3. */
export interface NativeFormatCheckFixtures {
  identity: NativeEvidenceIdentity;
  target: SkillReadTarget;
  since: number;
  through: number;
  positive: string;
  negatives: Record<'malformed' | 'role-spoof' | 'truncated' | 'mixed-version' | 'over-budget', string>;
  userMessage?: unknown;
}
const negativeNames = ['malformed', 'role-spoof', 'truncated', 'mixed-version', 'over-budget'] as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const revision = 'bounded-native-format-check-v1';
const resultSchema = z.object({
  schema: z.literal(1), adapterHash: hash, cliVersion: z.string().min(1).max(128),
  platform: z.string().min(1).max(64), parserRevision: z.literal(revision), sourceHash: hash,
  status: z.enum(['passed', 'failed']), checks: z.record(z.string(), z.boolean()),
  proven: z.array(z.literal('L2')).max(1), userMessageParsed: z.boolean(),
  checkedAt: z.iso.datetime(),
}).strict().refine(r => (r.status === 'passed') === (r.proven.length === 1));
export type NativeFormatCheckResult = z.infer<typeof resultSchema>;
const prefix = (adapterHash: string, cliVersion: string) => `agent-format-self-check:${adapterHash}:${digest(cliVersion)}:`;
const platform = () => `${process.platform}-${process.arch}`;

function observed(format: NativeEvidenceAdapter, fixtures: NativeFormatCheckFixtures, text: string, positive = false): boolean {
  if (typeof text !== 'string' || !text.endsWith('\n') || Buffer.byteLength(text) > 4 * 1024 * 1024) return false;
  const lines = text.slice(0, -1).split('\n');
  if (lines.length > 8192 || lines.some(line => Buffer.byteLength(line) > 1024 * 1024)) return false;
  try {
    if (format.validateHeader && !format.validateHeader(JSON.parse(lines[0]), fixtures.identity)) return false;
    const targets = [fixtures.target], args = [lines, targets, fixtures.since, fixtures.through] as const;
    const valid = (items: ReturnType<NonNullable<NativeEvidenceAdapter['observeSkillReads']>>) => items.length === 1 && items[0].skillId === fixtures.target.id && /^[a-f0-9]{64}$/.test(items[0].recordHash) && Date.parse(items[0].observedAt) >= fixtures.since && Date.parse(items[0].observedAt) <= fixtures.through;
    const reads = format.observeSkillReads?.(...args) ?? [], discoveries = format.observeSkillDiscoveries?.(...args) ?? [];
    return positive ? valid(reads) && valid(discoveries) : reads.length > 0 || discoveries.length > 0;
  } catch { return false; }
}

export function checkNativeFormat(format: NativeEvidenceAdapter, adapterHash: string, cliVersion: string, fixtures: NativeFormatCheckFixtures): NativeFormatCheckResult {
  const checks: Record<string, boolean> = {};
  const scopeValid = Number.isFinite(fixtures.since) && Number.isFinite(fixtures.through) && fixtures.since <= fixtures.through;
  checks.positive = scopeValid && observed(format, fixtures, fixtures.positive, true);
  for (const name of negativeNames) {
    // A missing negative is a failed probe, never evidence of rejection.
    const text = fixtures.negatives?.[name];
    checks[name] = typeof text === 'string' && text.length > 0 && !observed(format, fixtures, text);
  }
  let userMessageParsed = false;
  try { userMessageParsed = !!format.parseUserMessage?.(fixtures.userMessage, fixtures.identity); } catch { /* Diagnostic only. */ }
  const passed = Object.values(checks).every(Boolean);
  return resultSchema.parse({ schema: 1, adapterHash, cliVersion, platform: platform(), parserRevision: revision,
    sourceHash: digest(canonicalJson(fixtures)), status: passed ? 'passed' : 'failed', checks,
    proven: passed ? ['L2'] : [], userMessageParsed, checkedAt: new Date().toISOString() });
}

/** Existing host operation journal preserves every attempt; latest failure revokes
 * an earlier local promotion for this exact hash/version/platform. Raw logs and
 * parsed user text never enter the journal. */
export function storeNativeFormatCheck(store: ResourceStore, result: NativeFormatCheckResult): void {
  resultSchema.parse(result);
  store.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'agent-format-self-check',?,'committed',?,?,?)")
    .run(prefix(result.adapterHash, result.cliVersion) + randomUUID(), store.storeId, canonicalJson(result), result.checkedAt, result.checkedAt);
}
export function readNativeFormatCheck(store: ResourceStore, adapterHash: string, cliVersion: string): NativeFormatCheckResult | null {
  const rows = store.sqlite.prepare("SELECT plan_json FROM capability_resource_operations WHERE kind='agent-format-self-check' AND owner_store_id=? AND state='committed' AND operation_id LIKE ? ORDER BY rowid DESC LIMIT 32").all(store.storeId, prefix(adapterHash, cliVersion) + '%') as { plan_json: string }[];
  for (const row of rows) {
    try {
      const result = resultSchema.parse(JSON.parse(row.plan_json));
      if (result.adapterHash === adapterHash && result.cliVersion === cliVersion && result.platform === platform()) return result;
    } catch { return null; } // Corrupt current receipt cannot resurrect an older green.
  }
  return null;
}
