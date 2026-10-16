import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULTS } from '@shared/app-settings';
import { voiceGlobalErrorEvent } from '@shared/events';

const ipc = vi.hoisted(() => ({ listeners: new Map<string, (value: unknown) => void>(), inspect: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({
  rpc: { voice: { inspect: ipc.inspect } },
  events: { on: (event: { name: string }, callback: (value: unknown) => void) => {
    ipc.listeners.set(event.name, callback);
    return () => ipc.listeners.delete(event.name);
  } },
}));
import { voiceStore } from './voice-store';
import { navigation } from './navigation';

let disconnect: (() => void) | undefined;
beforeEach(() => { vi.stubGlobal('window', new EventTarget()); });
afterEach(() => { disconnect?.(); disconnect = undefined; voiceStore.clear(); ipc.listeners.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe('global voice errors in the visible app', () => {
  it('shows a permission error without system notification permission or changing the target view', async () => {
    ipc.inspect.mockResolvedValue({ settings: APP_SETTINGS_DEFAULTS.voice, accessibility: false });
    navigation.newTask();
    disconnect = voiceStore.connect();
    ipc.listeners.get(voiceGlobalErrorEvent.name)!('ACCESSIBILITY_REQUIRED');
    await Promise.resolve();
    expect(voiceStore.notice).toEqual({ kind: 'error', error: 'ACCESSIBILITY_REQUIRED' });
    expect(navigation.currentViewId).toBe('home');
    expect(voiceStore.pending).toBeNull();
    voiceStore.clear();
    expect(voiceStore.notice).toBeNull();
  });
  it('unsubscribes the error channel when the renderer disconnects', () => {
    ipc.inspect.mockResolvedValue({ settings: APP_SETTINGS_DEFAULTS.voice });
    disconnect = voiceStore.connect();
    expect(ipc.listeners.has(voiceGlobalErrorEvent.name)).toBe(true);
    disconnect(); disconnect = undefined;
    expect(ipc.listeners.has(voiceGlobalErrorEvent.name)).toBe(false);
  });
  it('rechecks on return from System Settings and removes only a resolved permission error', async () => {
    ipc.inspect.mockResolvedValue({ settings: APP_SETTINGS_DEFAULTS.voice, accessibility: false });
    disconnect = voiceStore.connect();
    await Promise.resolve();
    ipc.listeners.get(voiceGlobalErrorEvent.name)!('ACCESSIBILITY_REQUIRED');
    ipc.inspect.mockResolvedValue({ settings: APP_SETTINGS_DEFAULTS.voice, accessibility: true });
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(voiceStore.inspection?.accessibility).toBe(true);
    expect(voiceStore.notice).toBeNull();
    ipc.listeners.get(voiceGlobalErrorEvent.name)!('TARGET_CHANGED');
    window.dispatchEvent(new Event('focus'));
    await Promise.resolve();
    expect(voiceStore.notice).toEqual({ kind: 'error', error: 'TARGET_CHANGED' });
    disconnect(); disconnect = undefined;
    const calls = ipc.inspect.mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    expect(ipc.inspect).toHaveBeenCalledTimes(calls);
  });
  it('does not overwrite a fresh permission check with an older delayed response', async () => {
    let finishOld!: (value: unknown) => void;
    ipc.inspect.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    const old = voiceStore.inspect();
    ipc.inspect.mockResolvedValueOnce({ settings: APP_SETTINGS_DEFAULTS.voice, accessibility: true });
    await voiceStore.inspect();
    finishOld({ settings: APP_SETTINGS_DEFAULTS.voice, accessibility: false });
    await old;
    expect(voiceStore.inspection?.accessibility).toBe(true);
  });
});
