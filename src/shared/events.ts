import { defineEvent } from './ipc/events';
import type { SessionRecord } from './types';

// main → renderer
export const ptyDataEvent = defineEvent<{ ptyId: string; data: string }>('pty:data');
export const ptyExitEvent = defineEvent<{ ptyId: string; code: number }>('pty:exit');
export const sessionUpdatedEvent = defineEvent<SessionRecord>('session:updated');
export const menuOpenSettingsEvent = defineEvent<void>('menu:openSettings');
export const menuToggleLeftSidebarEvent = defineEvent<void>('menu:toggleLeftSidebar');

// renderer → main (fire-and-forget; keystrokes should not wait for an invoke round-trip)
export const ptyInputEvent = defineEvent<{ ptyId: string; data: string }>('pty:input');
export const ptyResizeEvent = defineEvent<{ ptyId: string; cols: number; rows: number }>('pty:resize');
