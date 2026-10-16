import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { APP_NAME, configureAppIdentity, resolveUserData } from './identity';

describe('WillYou rebrand preserves existing data', () => {
  it('keeps the old data root despite the new display name', () => {
    expect(APP_NAME).toBe('WillYou');
    expect(resolveUserData('/app-data')).toBe(join('/app-data', 'SmartDD'));
    expect(resolveUserData('/app-data', '')).toBe(join('/app-data', 'SmartDD'));
  });

  it('honors an isolated QA data directory without using the daily database', () => {
    expect(resolveUserData('/app-data', '/scratch/qa data')).toBe('/scratch/qa data');
  });

  it.each([undefined, '/scratch/qa data'])('keeps Electron encryption identity stable with data override %s', (override) => {
    // A packaged app starts with its new productName. Startup must override
    // that name before Electron selects the existing safeStorage namespace.
    let electronName = APP_NAME;
    const paths: Record<string, string> = { appData: '/app-data' };
    const app = {
      setName: vi.fn((name: string) => { electronName = name; }),
      getPath: vi.fn((name: string) => paths[name]),
      setPath: vi.fn((name: string, value: string) => { paths[name] = value; }),
    };
    configureAppIdentity(app, override);
    expect(`${electronName} Safe Storage`).toBe('SmartDD Safe Storage');
    expect(paths.userData).toBe(override ?? join('/app-data', 'SmartDD'));
    expect(APP_NAME).toBe('WillYou');
  });
});
