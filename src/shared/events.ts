import { defineEvent } from './ipc/events';

// main → renderer
export const ptyDataEvent = defineEvent<{ ptyId: string; data: string }>('pty:data');
export const ptyExitEvent = defineEvent<{ ptyId: string; code: number }>('pty:exit');
/** The task list or a task's running state changed; the renderer re-reads tasks.list. */
export const tasksChangedEvent = defineEvent<void>('tasks:changed');
export const menuOpenSettingsEvent = defineEvent<void>('menu:openSettings');
export const menuToggleLeftSidebarEvent = defineEvent<void>('menu:toggleLeftSidebar');

// renderer → main (fire-and-forget; keystrokes should not wait for an invoke round-trip)
export const ptyInputEvent = defineEvent<{ ptyId: string; data: string }>('pty:input');
export const ptyResizeEvent = defineEvent<{ ptyId: string; cols: number; rows: number }>('pty:resize');
