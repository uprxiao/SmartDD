// Ported from Yoda (Apache-2.0) src/main/core/settings/utils.ts.
export function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeDeep(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    const baseVal = base[k];
    result[k] = isPlainObject(v) && isPlainObject(baseVal) ? mergeDeep(baseVal, v) : v;
  }
  return result;
}

/** Fields of `value` that differ from `defaults` — what actually gets stored. */
export function computeDelta(value: Record<string, unknown>, defaults: Record<string, unknown>): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isDeepEqual(v, defaults[k])) delta[k] = v;
  }
  return delta;
}
