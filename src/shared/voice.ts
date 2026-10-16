import { z } from 'zod';
import type { AppSettings } from './app-settings';

export type VoiceSettings = AppSettings['voice'];
export const voiceTriggerSchema = z.object({
  requestId: z.string().min(1).max(80).regex(/^[\w-]+$/),
  origin: z.enum(['home', 'terminal', 'settings']),
  ptyId: z.string().max(100).optional(),
}).strict();
export type VoiceTrigger = z.infer<typeof voiceTriggerSchema>;
export type VoiceError = 'UNSUPPORTED_PLATFORM' | 'DISABLED' | 'NOT_INSTALLED' | 'ACCESSIBILITY_REQUIRED'
  | 'SHORTCUT_UNRESOLVED' | 'MODE_UNVERIFIED' | 'INVALID_SHORTCUT' | 'GLOBAL_CONFLICT' | 'SAME_SHORTCUT'
  | 'MODIFIERS_HELD' | 'TARGET_CHANGED' | 'INPUT_FOCUS_UNAVAILABLE' | 'SECURE_INPUT'
  | 'TASK_STOPPED' | 'LAUNCH_FAILED' | 'TIMEOUT' | 'TRIGGER_FAILED' | 'BUSY';
export type VoiceResult = { ok: true; phase: 'shortcut-sent' } | { ok: false; error: VoiceError };
export interface ShortcutCandidate { shortcut: string; source: string }
export interface VoiceInspection {
  supported: boolean;
  installed: boolean;
  running: boolean;
  accessibility: boolean;
  shortcut: string | null;
  source: 'override' | 'auto' | null;
  candidates: ShortcutCandidate[];
  effectiveGlobalShortcut: string | null;
  registrationError: VoiceError | null;
  lastError: VoiceError | null;
  settings: VoiceSettings;
}
