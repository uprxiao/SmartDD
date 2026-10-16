import { shell, BrowserWindow, systemPreferences } from 'electron';
import { createRPCController } from '@shared/ipc/rpc';
import type { VoiceTrigger, VoiceSettings } from '@shared/voice';
import type { VoiceService } from './voice-service';

export function createVoiceController(service: VoiceService) {
  let recordingTimer: ReturnType<typeof setTimeout> | null = null;
  const finishRecording = () => {
    if (recordingTimer) clearTimeout(recordingTimer);
    recordingTimer = null;
    service.setShortcutRecording(false);
    for (const window of BrowserWindow.getAllWindows()) window.webContents.setIgnoreMenuShortcuts(false);
  };
  return createRPCController({
    inspect: () => service.inspect(),
    setShortcutRecording: (active: boolean) => {
      const enabled = active === true;
      if (!enabled) { finishRecording(); return; }
      service.setShortcutRecording(enabled);
      if (recordingTimer) clearTimeout(recordingTimer);
      recordingTimer = setTimeout(finishRecording, 60_000); recordingTimer.unref();
      for (const window of BrowserWindow.getAllWindows()) window.webContents.setIgnoreMenuShortcuts(enabled);
    },
    trigger: (input: VoiceTrigger) => service.trigger(input),
    cancel: (id: string) => { if (typeof id === 'string' && id.length <= 80) service.cancel(id); },
    updateSettings: (patch: Partial<VoiceSettings>) => service.update(patch),
    resetSettings: () => service.reset(),
    openSetupGuide: async (kind: 'install' | 'permission') => {
      if (kind === 'install') await shell.openExternal('https://www.typeless.com/');
      else if (kind === 'permission' && process.platform === 'darwin') {
        // Only this explicit user action prompts macOS; inspect/trigger never grant or prompt.
        systemPreferences.isTrustedAccessibilityClient(true);
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      }
      else throw new Error('UNSUPPORTED_PLATFORM');
    },
  });
}
