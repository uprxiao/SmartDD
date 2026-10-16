import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { VoiceResult, ShortcutCandidate } from '@shared/voice';
import { parseShortcut, shortcutCandidates } from './shortcut-parser';

export interface NativeInspection { installed: boolean; running: boolean; accessibility: boolean }
export interface VoiceAdapter {
  supported: boolean;
  inspect(): Promise<NativeInspection>;
  candidates(): Promise<ShortcutCandidate[]>;
  trigger(shortcut: string, waitShortcut: string | null, signal: AbortSignal): Promise<VoiceResult>;
  released(shortcut: string): Promise<boolean>;
}

export class TypelessAdapter implements VoiceAdapter {
  supported = process.platform === 'darwin';
  constructor(private binary: string) {}
  private call<T>(command: string, data: object, signal?: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      execFile(this.binary, [command, JSON.stringify(data)], { timeout: 7000, maxBuffer: 4096, signal }, (error, stdout) => {
        if (error) { reject(new Error(signal?.aborted ? 'TARGET_CHANGED' : error.killed ? 'TIMEOUT' : 'TRIGGER_FAILED')); return; }
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('TRIGGER_FAILED')); }
      });
    });
  }
  inspect() { return this.supported ? this.call<NativeInspection>('inspect', {}) : Promise.resolve({ installed: false, running: false, accessibility: false }); }
  async candidates(): Promise<ShortcutCandidate[]> {
    if (!this.supported) return [];
    const seen = new Set<string>(); const result: ShortcutCandidate[] = [];
    for (const name of ['Typeless', 'typeless', 'now.typeless.desktop']) {
      try {
        const file = await realpath(join(homedir(), 'Library/Application Support', name, 'app-settings.json'));
        if (seen.has(file)) continue; seen.add(file);
        const meta = await stat(file); if (!meta.isFile() || meta.size > 1024 * 1024) continue;
        result.push(...shortcutCandidates(JSON.parse(await readFile(file, 'utf8'))));
      } catch { /* Missing/unreadable/invalid settings are an unresolved candidate, not a guessed shortcut. */ }
    }
    return result;
  }
  trigger(shortcut: string, waitShortcut: string | null, signal: AbortSignal) {
    return this.call<VoiceResult>('trigger', { codes: parseShortcut(shortcut).codes, waitCodes: waitShortcut ? parseShortcut(waitShortcut).codes : [] }, signal);
  }
  async released(shortcut: string) { return (await this.call<{ released: boolean }>('released', { codes: parseShortcut(shortcut).codes })).released; }
}
