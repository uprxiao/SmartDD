import assert from 'node:assert/strict';

export function withAbsoluteReset(reply, resetEpoch) {
  assert.equal(reply.status, 429);
  assert.equal(reply.body.error.code, 'usage_limit_reached');
  assert.equal(reply.body.error.resets_at, resetEpoch);
  assert(Number.isSafeInteger(resetEpoch) && resetEpoch > 1_000_000_000);
  const headers = { ...reply.headers };
  delete headers['x-codex-primary-reset-after-seconds'];
  headers['x-codex-primary-reset-at'] = String(resetEpoch);
  return { ...reply, headers };
}

export function monitorNativeRateLines(stream, events) {
  let pending = '';
  let skipLongLine = false;
  const maxLine = 256 * 1024;
  const onData = bytes => {
    const rows = bytes.toString('utf8').split('\n');
    for (const segment of rows.slice(0, -1)) {
      const line = pending + segment;
      if (!skipLongLine && line.length <= maxLine) consume(line);
      pending = '';
      skipLongLine = false;
    }
    pending += rows.at(-1);
    if (pending.length > maxLine) { pending = ''; skipLongLine = true; }
  };
  function consume(line) {
    if (events.length >= 64) return;
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const { method, params } = message ?? {};
    if (method === 'account/rateLimits/updated') {
      const quota = params?.rateLimits;
      const window = value => value && { usedPercent: value.usedPercent,
        windowDurationMins: value.windowDurationMins, resetsAt: value.resetsAt };
      events.push({ at: Date.now(), method, hasRpcId: Object.hasOwn(message, 'id'),
        rateLimits: quota && { limitId: quota.limitId, primary: window(quota.primary), secondary: window(quota.secondary) } });
    } else if (method === 'error' || method === 'turn/completed') {
      events.push({ at: Date.now(), method, threadId: params?.threadId,
        turnId: params?.turnId ?? params?.turn?.id,
        code: params?.error?.codexErrorInfo ?? params?.turn?.error?.codexErrorInfo ?? null,
        willRetry: params?.willRetry, state: params?.turn?.status });
    }
  }
  stream.on('data', onData);
  return () => stream.off('data', onData);
}

export function exactNativeReset(observed, resetEpoch) {
  return observed.find(row => row.method === 'account/rateLimits/updated' && !row.hasRpcId &&
    row.rateLimits?.primary?.usedPercent === 100 &&
    row.rateLimits.primary.resetsAt === resetEpoch && Number.isSafeInteger(row.rateLimits.primary.resetsAt)) ?? null;
}
