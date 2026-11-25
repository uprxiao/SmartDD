import {it,expect,vi} from 'vitest';
import {createVoiceController} from './controller';
import type {VoiceService} from './voice-service';
const mocks=vi.hoisted(()=>({legacy:vi.fn(),shell:vi.fn()}));
vi.mock('electron',()=>({BrowserWindow:{getAllWindows:()=>[{webContents:{setIgnoreMenuShortcuts:mocks.legacy}}]},shell:{},systemPreferences:{}}));
it('the old recording loop controls BrowserWindow-enumerated content, not an independent shell content owner',async()=>{
  const setShortcutRecording=vi.fn();const c=createVoiceController({setShortcutRecording} as unknown as VoiceService);
  try {c.setShortcutRecording(true);}finally{c.setShortcutRecording(false);}
  expect(setShortcutRecording.mock.calls).toEqual([[true],[false]]);
  expect(mocks.legacy.mock.calls).toEqual([[true],[false]]);
  expect(mocks.shell).not.toHaveBeenCalled();
});
