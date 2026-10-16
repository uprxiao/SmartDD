import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULTS } from '@shared/app-settings';
import type { VoiceResult, VoiceSettings } from '@shared/voice';
import type { VoiceAdapter } from './typeless-adapter';
import { VoiceService } from './voice-service';
import { globalAccelerator, parseShortcut, resolveCandidate, shortcutCandidates } from './shortcut-parser';
import { openDbClient } from '@main/db/client';
import { runBundledMigrations } from '@main/db/migrations';
import { SettingsStore } from '../settings/settings-service';
import { createAppSettingsController } from '../settings/controller';

const services: VoiceService[] = [];
afterEach(() => { services.splice(0).forEach(s => s.dispose()); vi.useRealTimers(); });
function setup(overrides: Partial<VoiceSettings> = {}) {
  let value: VoiceSettings = { ...APP_SETTINGS_DEFAULTS.voice, shortcutOverride: 'RightOption', ...overrides };
  const registered = new Map<string, () => void>();
  const adapter: VoiceAdapter = {
    supported: true,
    inspect: vi.fn(async () => ({ installed: true, running: true, accessibility: true })),
    candidates: vi.fn(async () => [{ shortcut: 'RightOption', source: 'featureShortcutBindings.dictationMode' }]),
    trigger: vi.fn(async (): Promise<VoiceResult> => ({ ok: true, phase: 'shortcut-sent' })),
    released: vi.fn(async () => true),
  };
  const settings = { get: () => value, save: vi.fn(async (v: VoiceSettings) => { value = v; }) };
  const shortcuts = { register: vi.fn((key: string, cb: () => void) => { registered.set(key, cb); return true; }), unregister: vi.fn((key: string) => { registered.delete(key); }) };
  const deps = { adapter, settings, shortcuts, focused: vi.fn(() => true), ptyAlive: vi.fn(() => true), changed: vi.fn(), globalError: vi.fn() };
  const service = new VoiceService(deps); services.push(service);
  return { service, ...deps, registered };
}
const request = { origin: 'home' as const, requestId: 'test-request' };

describe('Typeless keys and configuration', () => {
  it('normalizes aliases/order while retaining side-specific native codes', () => {
    expect(parseShortcut('RightOption').codes).toEqual([61]);
    expect(parseShortcut('Shift+Cmd+Space').canonical).toBe(parseShortcut('Command+Shift+Space').canonical);
    expect(parseShortcut('RightAlt').canonical).toBe(parseShortcut('Option').canonical);
    expect(globalAccelerator('Shift+Cmd+Space')).toBe('Command+Shift+Space');
  });
  it.each(['', 'Cmd++V', 'unknown', 'Command+Command+V', 'Alt+RightOption', 'A+B', 'Space+Cmd', '"; do shell script "bad'])('rejects malformed key %s', key => expect(() => parseShortcut(key)).toThrow());
  it.each(['Option', 'A', 'Fn+Space', 'RightOption+V', 'Command+K', 'Cmd+C', 'Command+W', 'Command+Return'])('rejects unsafe/reserved global key %s', key => expect(() => globalAccelerator(key)).toThrow());
  it('does not treat askAnything, hold-to-talk, unknown fields, or conflicting modes as dictation', () => {
    expect(shortcutCandidates({ token: 'secret', featureShortcutBindings: { askAnythingMode: ['Fn+Space'] } })).toEqual([]);
    expect(resolveCandidate(shortcutCandidates({ keyboardShortcut: { pushToTalk: 'RightOption' } }))).toBeNull();
    expect(resolveCandidate(shortcutCandidates({ featureShortcutBindings: { dictationMode: ['RightOption'] }, keyboardShortcut: { handlesFreeMode: 'Fn+Space' } }))).toBeNull();
    expect(resolveCandidate(shortcutCandidates({ featureShortcutBindings: { dictationMode: ['RightOption'] } }))).toBe('RightOption');
  });
});

describe('VoiceService transactions', () => {
  it('keeps old key and persisted settings on registration failure', async () => {
    const x = setup({ globalEnabled: true }); await x.service.start();
    x.shortcuts.register.mockReturnValueOnce(false);
    await expect(x.service.update({ globalShortcut: 'Control+Shift+9' })).rejects.toThrow('GLOBAL_CONFLICT');
    expect(x.registered.has('Command+Shift+Space')).toBe(true);
    expect(x.settings.get().globalShortcut).toBe('Command+Shift+Space');
    expect(x.settings.save).not.toHaveBeenCalled();
  });
  it('undoes new registration on persistence failure and releases old key only after successful save', async () => {
    const x = setup({ globalEnabled: true }); await x.service.start();
    x.settings.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(x.service.update({ globalShortcut: 'Control+Shift+9' })).rejects.toThrow('disk full');
    expect([...x.registered.keys()]).toEqual(['Command+Shift+Space']);
    await x.service.update({ globalShortcut: 'Control+Shift+9' });
    expect([...x.registered.keys()]).toEqual(['Control+Shift+9']);
    await x.service.update({ enabled: false });
    expect(x.registered.size).toBe(0);
  });
  it('serializes simultaneous updates and does not register the same key twice', async () => {
    const x = setup({ globalEnabled: true }); await x.service.start();
    await Promise.all([x.service.update({ shortcutOverride: 'Fn+Space' }), x.service.update({ provider: 'typeless' })]);
    expect(x.shortcuts.register).toHaveBeenCalledTimes(1);
    expect(x.settings.get().shortcutOverride).toBe('Fn+Space');
  });
  it('reports failed startup registration without losing the user intention', async () => {
    const x = setup({ globalEnabled: true }); x.shortcuts.register.mockReturnValue(false);
    await x.service.start();
    expect(await x.service.inspect()).toMatchObject({ effectiveGlobalShortcut: null, registrationError: 'GLOBAL_CONFLICT', settings: { globalEnabled: true } });
  });
  it('rejects equal shortcuts even with alternate names and ordering', async () => {
    const x = setup();
    await expect(x.service.update({ globalEnabled: true, shortcutOverride: 'Shift+Cmd+Space' })).rejects.toThrow('SAME_SHORTCUT');
  });
  it('generic settings update/reset/resetField use the same coordinator and persist across restart', async () => {
    const db = openDbClient(':memory:'); runBundledMigrations(db.sqlite);
    try {
      const store = new SettingsStore(db.db); const x = setup();
      const service = new VoiceService({ ...x, settings: { get: () => store.get('voice'), save: v => store.update('voice', v) } }); services.push(service);
      const controller = createAppSettingsController(store, () => {}, service);
      await controller.update('voice', { globalEnabled: true, shortcutOverride: 'RightOption' });
      expect(new SettingsStore(db.db).get('voice').globalEnabled).toBe(true);
      await controller.resetField('voice', 'globalEnabled');
      expect(x.registered.size).toBe(0);
      await controller.reset('voice');
      expect(store.get('voice')).toEqual(APP_SETTINGS_DEFAULTS.voice);
    } finally { db.close(); }
  });
});

describe('VoiceService dispatch and lifecycle', () => {
  it.each(['INPUT_FOCUS_UNAVAILABLE', 'TARGET_CHANGED', 'SECURE_INPUT'] as const)('keeps the distinct native focus failure %s', async error => {
    const x = setup();
    vi.mocked(x.adapter.trigger).mockRejectedValueOnce(new Error(error));
    expect(await x.service.trigger(request)).toEqual({ ok: false, error });
    expect((await x.service.inspect()).lastError).toBe(error);
    expect(x.adapter.trigger).toHaveBeenCalledTimes(1); // No automatic shortcut replay.
  });
  it('shows the last failed request and clears it after a successful retry', async () => {
    const x = setup();
    vi.mocked(x.adapter.trigger).mockResolvedValueOnce({ ok: false, error: 'TRIGGER_FAILED' });
    await x.service.trigger(request);
    expect((await x.service.inspect()).lastError).toBe('TRIGGER_FAILED');
    await x.service.trigger(request);
    expect((await x.service.inspect()).lastError).toBeNull();
  });
  it('clears a historical permission error only when the native bridge confirms access', async () => {
    const x = setup();
    vi.mocked(x.adapter.inspect).mockResolvedValue({ installed: true, running: true, accessibility: false });
    expect(await x.service.trigger(request)).toEqual({ ok: false, error: 'ACCESSIBILITY_REQUIRED' });
    expect((await x.service.inspect()).lastError).toBe('ACCESSIBILITY_REQUIRED');
    vi.mocked(x.adapter.inspect).mockResolvedValue({ installed: true, running: true, accessibility: true });
    expect((await x.service.inspect()).lastError).toBeNull();
    expect(x.adapter.trigger).not.toHaveBeenCalled();
  });
  it('does not invoke dictation while recording a new global shortcut', async () => {
    vi.useFakeTimers();
    const x = setup({ globalEnabled: true }); await x.service.start();
    const oldCallback = x.registered.get('Command+Shift+Space')!;
    x.service.setShortcutRecording(true);
    expect(x.registered.size).toBe(0); // The OS must deliver this key to the recording input.
    oldCallback(); // Ignore any callback already queued before unregister.
    await Promise.resolve();
    expect(x.adapter.trigger).not.toHaveBeenCalled();
    x.service.setShortcutRecording(false);
    expect([...x.registered.keys()]).toEqual(['Command+Shift+Space']);
    await vi.advanceTimersByTimeAsync(250);
    expect(x.adapter.trigger).not.toHaveBeenCalled();
    x.registered.get('Command+Shift+Space')!();
    await vi.advanceTimersByTimeAsync(1);
    expect(x.adapter.trigger).toHaveBeenCalledTimes(1);
    expect(x.settings.save).not.toHaveBeenCalled();
  });
  it('restores only once, and never triggers from a held recorded key', async () => {
    vi.useFakeTimers();
    const x = setup({ globalEnabled: true }); await x.service.start();
    x.adapter.released = vi.fn(async () => false);
    x.service.setShortcutRecording(true); x.service.setShortcutRecording(true);
    expect(x.shortcuts.unregister).toHaveBeenCalledTimes(1);
    x.service.setShortcutRecording(false); x.service.setShortcutRecording(false);
    expect(x.shortcuts.register).toHaveBeenCalledTimes(2);
    x.registered.get('Command+Shift+Space')!();
    await vi.advanceTimersByTimeAsync(500);
    expect(x.adapter.trigger).not.toHaveBeenCalled();
    x.adapter.released = vi.fn(async () => true);
    await vi.advanceTimersByTimeAsync(250);
    expect(x.adapter.trigger).not.toHaveBeenCalled();
    x.registered.get('Command+Shift+Space')!();
    await vi.advanceTimersByTimeAsync(1);
    expect(x.adapter.trigger).toHaveBeenCalledTimes(1);
  });
  it('reports a restore conflict and preserves the saved key for retry', async () => {
    const x = setup({ globalEnabled: true }); await x.service.start();
    x.service.setShortcutRecording(true);
    x.shortcuts.register.mockReturnValueOnce(false);
    x.service.setShortcutRecording(false);
    expect(await x.service.inspect()).toMatchObject({ effectiveGlobalShortcut: null, registrationError: 'GLOBAL_CONFLICT', settings: { globalShortcut: 'Command+Shift+Space', globalEnabled: true } });
    expect(x.settings.save).not.toHaveBeenCalled();
    await x.service.update({});
    expect(x.registered.has('Command+Shift+Space')).toBe(true);
  });
  it('does not let update/reset or dictation compete with an active recorder', async () => {
    const x = setup({ globalEnabled: true }); await x.service.start();
    x.service.setShortcutRecording(true);
    await expect(x.service.update({ globalShortcut: 'Control+Shift+9' })).rejects.toThrow('BUSY');
    await expect(x.service.reset()).rejects.toThrow('BUSY');
    expect(await x.service.trigger(request)).toEqual({ ok: false, error: 'BUSY' });
    expect(x.settings.save).not.toHaveBeenCalled();
    expect(x.registered.size).toBe(0);
    x.service.dispose(); x.service.setShortcutRecording(false);
    expect(x.registered.size).toBe(0);
    expect(x.shortcuts.register).toHaveBeenCalledTimes(1);
  });
  it('blocks missing permission, missing installation, unsupported platform, stopped PTY and lost focus', async () => {
    const x = setup();
    x.adapter.inspect = vi.fn(async () => ({ installed: true, running: true, accessibility: false }));
    expect(await x.service.trigger(request)).toEqual({ ok: false, error: 'ACCESSIBILITY_REQUIRED' });
    x.adapter.inspect = vi.fn(async () => ({ installed: false, running: false, accessibility: false }));
    expect(await x.service.trigger(request)).toEqual({ ok: false, error: 'NOT_INSTALLED' });
    x.ptyAlive.mockReturnValue(false);
    expect(await x.service.trigger({ ...request, origin: 'terminal', ptyId: 'gone' })).toEqual({ ok: false, error: 'TASK_STOPPED' });
    x.focused.mockReturnValue(false);
    expect(await x.service.trigger(request)).toEqual({ ok: false, error: 'TARGET_CHANGED' });
    x.adapter.supported = false;
    expect(await x.service.trigger(request)).toEqual({ ok: false, error: 'UNSUPPORTED_PLATFORM' });
    expect(x.adapter.trigger).not.toHaveBeenCalled();
  });
  it('allows one request, cancels a cold launch without replaying or exposing text', async () => {
    const x = setup();
    x.adapter.trigger = vi.fn((_key, _wait, signal) => new Promise<VoiceResult>(resolve => signal.addEventListener('abort', () => resolve({ ok: false, error: 'TARGET_CHANGED' }))));
    const pending = x.service.trigger(request);
    await vi.waitFor(() => expect(x.adapter.trigger).toHaveBeenCalledTimes(1));
    expect(await x.service.trigger({ ...request, requestId: 'second' })).toEqual({ ok: false, error: 'BUSY' });
    x.service.cancel('wrong-id');
    x.service.cancel(request.requestId);
    expect(await pending).toEqual({ ok: false, error: 'TARGET_CHANGED' });
  });
  it('rechecks the focused app while inspecting and does not forward to a different target', async () => {
    const x = setup();
    x.adapter.inspect = vi.fn(async () => { x.focused.mockReturnValue(false); return { installed: true, running: true, accessibility: true }; });
    expect(await x.service.trigger(request)).toEqual({ ok: false, error: 'TARGET_CHANGED' });
    expect(x.adapter.trigger).not.toHaveBeenCalled();
  });
  it('rechecks auto-detected keys to prevent recursion after Typeless settings change', async () => {
    const x = setup({ globalEnabled: true, shortcutOverride: null }); await x.service.start();
    x.adapter.candidates = vi.fn(async () => [{ shortcut: 'Shift+Cmd+Space', source: 'featureShortcutBindings.dictationMode' }]);
    expect(await x.service.trigger(request)).toEqual({ ok: false, error: 'SAME_SHORTCUT' });
  });
  it('global dispatch keeps SmartDD unfocused, passes physical-release keys, and drops held-key repeats', async () => {
    vi.useFakeTimers();
    const x = setup({ globalEnabled: true }); await x.service.start(); x.focused.mockReturnValue(false);
    x.adapter.trigger = vi.fn(async (): Promise<VoiceResult> => ({ ok: false, error: 'MODIFIERS_HELD' }));
    x.adapter.released = vi.fn(async () => false);
    const callback = x.registered.get('Command+Shift+Space')!;
    callback(); await vi.advanceTimersByTimeAsync(1);
    expect(x.adapter.trigger).toHaveBeenCalledWith('RightOption', 'Command+Shift+Space', expect.any(AbortSignal));
    callback(); await vi.advanceTimersByTimeAsync(300);
    expect(x.adapter.trigger).toHaveBeenCalledTimes(1);
    x.adapter.released = vi.fn(async () => true); await vi.advanceTimersByTimeAsync(300);
    expect(x.adapter.trigger).toHaveBeenCalledTimes(1); // re-arm only, never automatic retry
    callback(); await vi.advanceTimersByTimeAsync(1);
    expect(x.adapter.trigger).toHaveBeenCalledTimes(2);
    x.service.dispose(); expect(x.registered.size).toBe(0);
  });
});
