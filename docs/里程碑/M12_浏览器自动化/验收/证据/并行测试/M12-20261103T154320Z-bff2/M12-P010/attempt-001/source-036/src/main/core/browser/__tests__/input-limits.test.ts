import { describe, expect, it } from 'vitest';
import { BrowserHelper } from '../agent-browser';

// No clipboard or process is touched. An invalid executable makes a missing host-side
// preflight observable: the rejection must precede any file hashing or child launch.
describe('host browser clipboard byte limit', () => {
  it('rejects 16MiB plus one byte at the executor boundary before prepare/dispatch', async () => {
    let dispatched = false;
    const helper = new BrowserHelper({
      executable: '/private/tmp/willyou-m12-s1-must-not-run', sha256: '0'.repeat(64),
      home: '/private/tmp/willyou-m12-s1-must-not-create', session: 'limit', endpoint: 'ws://127.0.0.1:1/not-used',
    }, () => {});
    await expect(helper.command(['clipboard', 'write', 'x'.repeat(16 * 1024 * 1024 + 1)], {
      dispatched: () => { dispatched = true; },
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(helper.command(['clipboard', 'write', '中'.repeat(Math.floor(16 * 1024 * 1024 / 3) + 1)]))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(dispatched).toBe(false);
  });
});
