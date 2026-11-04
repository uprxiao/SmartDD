import { describe, expect, it } from 'vitest';
import { pickLaunchProfile } from './launch-profile';

const profile = (id: string, extra: { isDefault?: boolean; status?: 'ok' | 'warning' | 'failed'; checking?: boolean } = {}) => ({
  id,
  isDefault: extra.isDefault ?? false,
  checking: extra.checking ?? false,
  check: extra.status ? { status: extra.status, at: 0, message: '' } : null,
}) as Parameters<typeof pickLaunchProfile>[0][number];

describe('home composer profile choice', () => {
  it('prefers a usable default over the last choice, including untested, warning and checking defaults', () => {
    for (const extra of [{}, { status: 'ok' as const }, { status: 'warning' as const }, { status: 'failed' as const, checking: true }])
      expect(pickLaunchProfile([profile('last', { status: 'ok' }), profile('default', { isDefault: true, ...extra })], 'last')).toBe('default');
  });
  it('falls back to the last choice, then the first usable profile, when the default failed', () => {
    const failedDefault = profile('default', { isDefault: true, status: 'failed' });
    expect(pickLaunchProfile([profile('other'), failedDefault, profile('last')], 'last')).toBe('last');
    expect(pickLaunchProfile([profile('last', { status: 'failed' }), failedDefault, profile('other')], 'last')).toBe('other');
    expect(pickLaunchProfile([failedDefault, profile('other')], 'deleted')).toBe('other');
  });
  it('keeps the default when nothing is usable, and selects nothing without profiles', () => {
    expect(pickLaunchProfile([profile('last', { status: 'failed' }), profile('default', { isDefault: true, status: 'failed' })], 'last')).toBe('default');
    expect(pickLaunchProfile([], 'last')).toBeNull();
  });
});
