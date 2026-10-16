import { makeAutoObservable, reaction, runInAction } from 'mobx';
import type { VoiceError, VoiceInspection, VoiceTrigger } from '@shared/voice';
import { voiceGlobalErrorEvent, voiceStatusChangedEvent } from '@shared/events';
import { events, rpc } from '@renderer/lib/ipc';
import { navigation } from './navigation';

export interface VoiceTarget { element: HTMLElement; focus(): void; available(): boolean }
export function textareaVoiceTarget(element: HTMLTextAreaElement | null): VoiceTarget | null {
  if (!element) return null;
  const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = element;
  return { element, available: () => element.isConnected && !element.disabled && element.getClientRects().length > 0, focus: () => { element.focus({ preventScroll: true }); element.setSelectionRange(start, end, direction); } };
}
class VoiceStore {
  inspection: VoiceInspection | null = null;
  inspecting = false;
  notice: { kind: 'pending' | 'sent' | 'error'; error?: VoiceError } | null = null;
  pending: string | null = null;
  private detachTarget: (() => void) | null = null;
  private inspectRevision = 0;
  constructor() { makeAutoObservable(this, {}, { autoBind: true }); }
  get busy() { return this.pending !== null; }
  async inspect() {
    const revision = ++this.inspectRevision;
    this.inspecting = true;
    try { const status = await rpc.voice.inspect(); runInAction(() => {
      if (revision !== this.inspectRevision) return;
      this.inspection = status;
      if (status.accessibility && this.notice?.error === 'ACCESSIBILITY_REQUIRED') this.notice = null;
    }); }
    catch { runInAction(() => { if (revision === this.inspectRevision) this.notice = { kind: 'error', error: 'TRIGGER_FAILED' }; }); }
    finally { runInAction(() => { if (revision === this.inspectRevision) this.inspecting = false; }); }
  }
  connect() {
    void this.inspect();
    const offEvent = events.on(voiceStatusChangedEvent, () => void this.inspect());
    const offGlobalError = events.on(voiceGlobalErrorEvent, error => {
      runInAction(() => { this.notice = { kind: 'error', error }; });
    });
    const offRoute = reaction(() => [navigation.currentViewId, navigation.currentTaskId, navigation.currentProjectId, navigation.settingsSection, navigation.homePreset?.seq], () => this.clear());
    // Returning from System Settings rechecks the running bridge without
    // requesting permission or replaying the previous dictation shortcut.
    const recheck = () => void this.inspect();
    window.addEventListener('focus', recheck);
    return () => { window.removeEventListener('focus', recheck); offEvent(); offGlobalError(); offRoute(); this.clear(); };
  }
  clear() {
    if (this.pending) void rpc.voice.cancel(this.pending);
    this.detachTarget?.(); this.detachTarget = null;
    this.pending = null; this.notice = null;
  }
  async trigger(target: VoiceTarget | null, origin: VoiceTrigger['origin'], ptyId?: string) {
    if (this.pending) return;
    if (!target?.available()) { this.notice = { kind: 'error', error: origin === 'terminal' ? 'TASK_STOPPED' : 'TARGET_CHANGED' }; return; }
    target.focus();
    const requestId = crypto.randomUUID();
    this.pending = requestId; this.notice = { kind: 'pending' };
    const cancel = () => { if (this.pending === requestId) this.clear(); };
    const focusChanged = (e: FocusEvent) => { if (e.target !== target.element) cancel(); };
    window.addEventListener('blur', cancel); document.addEventListener('focusin', focusChanged);
    // Switching tabs or removing a target while Typeless starts must cancel the dispatch.
    const timer = window.setInterval(() => { if (!target.available()) cancel(); }, 50);
    this.detachTarget = () => { window.removeEventListener('blur', cancel); document.removeEventListener('focusin', focusChanged); clearInterval(timer); };
    try {
      const result = await rpc.voice.trigger({ requestId, origin, ptyId });
      runInAction(() => {
        if (this.pending !== requestId) return;
        this.notice = result.ok ? { kind: 'sent' } : { kind: 'error', error: result.error };
      });
    } catch { runInAction(() => { if (this.pending === requestId) this.notice = { kind: 'error', error: 'TRIGGER_FAILED' }; }); }
    finally { runInAction(() => { if (this.pending === requestId) { this.detachTarget?.(); this.detachTarget = null; this.pending = null; } }); }
  }
}
export const voiceStore = new VoiceStore();
