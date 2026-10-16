import { APP_SETTINGS_DEFAULTS, APP_SETTINGS_STRICT_SCHEMA_MAP } from '@shared/app-settings';
import { voiceTriggerSchema, type VoiceError, type VoiceInspection, type VoiceResult, type VoiceSettings, type VoiceTrigger } from '@shared/voice';
import { globalAccelerator, parseShortcut, resolveCandidate } from './shortcut-parser';
import type { VoiceAdapter } from './typeless-adapter';

interface VoiceDependencies {
  adapter: VoiceAdapter;
  settings: { get(): VoiceSettings; save(value: VoiceSettings): Promise<unknown> };
  shortcuts: { register(key: string, callback: () => void): boolean; unregister(key: string): void };
  focused(): boolean;
  ptyAlive(id: string): boolean;
  changed(): void;
  globalError(error: VoiceError): void;
}
export class VoiceService {
  private activeKey: string | null = null;
  private registrationError: VoiceError | null = null;
  private lastError: VoiceError | null = null;
  private inFlight: { id: string; abort: AbortController } | null = null;
  private queue = Promise.resolve();
  private saving = false;
  private disposed = false;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private globalHeld = false;
  private releaseGeneration = 0;
  private shortcutRecording = false;
  private recordingRevision = 0;
  private suspendedKey: string | null = null;
  setShortcutRecording(active: boolean) {
    if (this.disposed || active === this.shortcutRecording) return;
    if (active && this.saving) throw new Error('BUSY');
    this.shortcutRecording = active;
    if (active) {
      this.recordingRevision++;
      this.cancel();
      this.releaseGeneration++;
      if (this.releaseTimer) clearTimeout(this.releaseTimer);
      this.releaseTimer = null; this.globalHeld = false;
      this.suspendedKey = this.activeKey;
      if (this.activeKey) this.d.shortcuts.unregister(this.activeKey);
      this.activeKey = null;
    } else {
      const key = this.suspendedKey;
      this.suspendedKey = null;
      if (key) {
        if (this.d.shortcuts.register(key, () => this.onGlobal())) {
          this.activeKey = key;
          this.registrationError = null;
          this.waitForGlobalRelease(key);
        } else this.registrationError = 'GLOBAL_CONFLICT';
      }
    }
    this.d.changed();
  }
  constructor(private d: VoiceDependencies) {}

  async inspect(): Promise<VoiceInspection> {
    const [native, candidates] = await Promise.all([this.d.adapter.inspect(), this.d.adapter.candidates()]);
    // A fresh native check supersedes a historical permission failure. Other
    // failures stay visible until a successful request or settings change.
    if (native.accessibility && this.lastError === 'ACCESSIBILITY_REQUIRED') this.lastError = null;
    const settings = this.d.settings.get();
    const shortcut = settings.shortcutOverride || resolveCandidate(candidates);
    return { ...native, candidates, supported: this.d.adapter.supported, settings, shortcut, source: shortcut ? settings.shortcutOverride ? 'override' : 'auto' : null, effectiveGlobalShortcut: this.activeKey, registrationError: this.registrationError, lastError: this.lastError };
  }

  private async validated(value: VoiceSettings) {
    const parsed = APP_SETTINGS_STRICT_SCHEMA_MAP.voice.strict().parse(value);
    parsed.shortcutOverride = parsed.shortcutOverride || null;
    if (parsed.shortcutOverride) parseShortcut(parsed.shortcutOverride);
    const key = globalAccelerator(parsed.globalShortcut);
    if (parsed.enabled && parsed.globalEnabled) {
      if (!this.d.adapter.supported) throw new Error('UNSUPPORTED_PLATFORM');
      const forward = parsed.shortcutOverride || resolveCandidate(await this.d.adapter.candidates());
      if (!forward) throw new Error('SHORTCUT_UNRESOLVED');
      if (parseShortcut(forward).canonical === parseShortcut(key).canonical) throw new Error('SAME_SHORTCUT');
    }
    parsed.globalShortcut = key;
    return parsed;
  }

  /** New registration -> persistence -> old registration release; any failure keeps the old pair. */
  update(patch: Partial<VoiceSettings>): Promise<VoiceSettings> {
    const task = this.queue.then(async () => {
      if (this.disposed) throw new Error('DISABLED');
      if (this.shortcutRecording) throw new Error('BUSY');
      this.saving = true;
      try {
        const value = await this.validated({ ...this.d.settings.get(), ...patch });
        if (this.disposed) throw new Error('DISABLED');
        const next = value.enabled && value.globalEnabled ? value.globalShortcut : null;
        const old = this.activeKey;
        if (next && next !== old && !this.d.shortcuts.register(next, () => this.onGlobal())) throw new Error('GLOBAL_CONFLICT');
        try { await this.d.settings.save(value); }
        catch (e) { if (next && next !== old) this.d.shortcuts.unregister(next); throw e; }
        if (old && old !== next) this.d.shortcuts.unregister(old);
        this.activeKey = next;
        if (!value.enabled) this.cancel();
        this.registrationError = null; this.lastError = null;
        this.d.changed();
        return value;
      } finally { this.saving = false; }
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
  reset() { return this.update(APP_SETTINGS_DEFAULTS.voice); }
  async start() {
    try {
      const value = await this.validated(this.d.settings.get());
      if (this.disposed || this.shortcutRecording || !value.enabled || !value.globalEnabled) return;
      if (!this.d.shortcuts.register(value.globalShortcut, () => this.onGlobal())) throw new Error('GLOBAL_CONFLICT');
      this.activeKey = value.globalShortcut;
    } catch (e) { this.registrationError = knownError(e); }
    this.d.changed();
  }
  async trigger(input: VoiceTrigger) {
    const result = await this.dispatch(voiceTriggerSchema.parse(input));
    this.lastError = result.ok ? null : result.error;
    this.d.changed();
    return result;
  }
  private async dispatch(input: VoiceTrigger | { origin: 'global'; requestId: string }): Promise<VoiceResult> {
    if (this.inFlight || this.saving || this.shortcutRecording) return { ok: false, error: 'BUSY' };
    if (this.disposed || !this.d.settings.get().enabled) return { ok: false, error: 'DISABLED' };
    if (!this.d.adapter.supported) return { ok: false, error: 'UNSUPPORTED_PLATFORM' };
    const validTarget = () => input.origin === 'global' || (this.d.focused() && (input.origin !== 'terminal' || Boolean(input.ptyId && this.d.ptyAlive(input.ptyId))));
    if (!validTarget()) return { ok: false, error: input.origin === 'terminal' ? 'TASK_STOPPED' : 'TARGET_CHANGED' };
    const abort = new AbortController();
    this.inFlight = { id: input.requestId, abort };
    // The renderer also cancels on route/focus changes. Recheck task/window while cold launching.
    const timer = setInterval(() => { if (!validTarget()) abort.abort(); }, 50);
    try {
      const status = await this.inspect();
      if (!status.installed) return { ok: false, error: 'NOT_INSTALLED' };
      if (!status.shortcut) return { ok: false, error: 'SHORTCUT_UNRESOLVED' };
      if (!status.accessibility) return { ok: false, error: 'ACCESSIBILITY_REQUIRED' };
      if (this.activeKey && parseShortcut(this.activeKey).canonical === parseShortcut(status.shortcut).canonical) return { ok: false, error: 'SAME_SHORTCUT' };
      if (abort.signal.aborted || !validTarget()) return { ok: false, error: 'TARGET_CHANGED' };
      return await this.d.adapter.trigger(status.shortcut, input.origin === 'global' ? this.activeKey : null, abort.signal);
    } catch (e) { return { ok: false, error: knownError(e) }; }
    finally { clearInterval(timer); this.inFlight = null; }
  }
  cancel(id?: string) { if (!id || this.inFlight?.id === id) this.inFlight?.abort.abort(); }
  private onGlobal() {
    if (this.shortcutRecording || this.globalHeld || this.inFlight || this.disposed) return;
    const key = this.activeKey;
    if (!key) return;
    const revision = this.recordingRevision;
    void this.dispatch({ origin: 'global', requestId: 'global' }).then(result => {
      if (this.disposed || revision !== this.recordingRevision) return;
      this.lastError = result.ok ? null : result.error;
      this.d.changed();
      if (!result.ok && result.error !== 'BUSY') {
        this.d.globalError(result.error);
        if (result.error === 'MODIFIERS_HELD') {
          // Cancel this invocation; merely re-arm after physical release, never retry the action.
          this.waitForGlobalRelease(key);
        }
      }
    });
  }
  private waitForGlobalRelease(key: string) {
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.globalHeld = true;
    const generation = ++this.releaseGeneration;
    const check = async () => {
      if (this.disposed || generation !== this.releaseGeneration) return;
      const released = await this.d.adapter.released(key).catch(() => false);
      if (this.disposed || generation !== this.releaseGeneration) return;
      if (released) { this.globalHeld = false; this.releaseTimer = null; }
      else this.releaseTimer = setTimeout(() => void check(), 250);
    };
    this.releaseTimer = setTimeout(() => void check(), 250);
  }
  dispose() {
    this.disposed = true; this.cancel();
    this.releaseGeneration++;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    if (this.activeKey) this.d.shortcuts.unregister(this.activeKey);
    this.activeKey = null; this.suspendedKey = null;
  }
}

function knownError(error: unknown): VoiceError {
  const code = error instanceof Error ? error.message : '';
  const allowed: VoiceError[] = ['UNSUPPORTED_PLATFORM', 'DISABLED', 'NOT_INSTALLED', 'ACCESSIBILITY_REQUIRED', 'SHORTCUT_UNRESOLVED', 'INVALID_SHORTCUT', 'GLOBAL_CONFLICT', 'SAME_SHORTCUT', 'MODIFIERS_HELD', 'TARGET_CHANGED', 'INPUT_FOCUS_UNAVAILABLE', 'SECURE_INPUT', 'TASK_STOPPED', 'LAUNCH_FAILED', 'TIMEOUT', 'TRIGGER_FAILED'];
  return allowed.includes(code as VoiceError) ? code as VoiceError : 'TRIGGER_FAILED';
}
