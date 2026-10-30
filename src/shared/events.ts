import type { ViewerUiEvent } from './file-viewer';
import { defineEvent } from './ipc/events';
import type { ProfileCheckSource } from './ai-profiles';
import type { VoiceError } from './voice';
import type { FileCloseRequest, FileSearchProgress, FileWatchUpdate } from './files';
import type { HtmlPreviewState } from './file-html';
import type { WorkspaceUpdate } from './file-workspace';

// main → renderer
export const ptyDataEvent = defineEvent<{ ptyId: string; data: string }>('pty:data');
export const ptyExitEvent = defineEvent<{ ptyId: string; code: number }>('pty:exit');
/** The task list or a task's running state changed; the renderer re-reads tasks.list. */
export const tasksChangedEvent = defineEvent<void>('tasks:changed');
export const fileWatchEvent = defineEvent<FileWatchUpdate>('files:watch');
export const fileSearchEvent = defineEvent<FileSearchProgress>('files:search');
export const fileCloseEvent = defineEvent<FileCloseRequest>('files:close-request');
export const fileHtmlEvent = defineEvent<HtmlPreviewState & { id: string }>('files:html-state');
export const fileWorkspaceEvent = defineEvent<WorkspaceUpdate>('files:workspace');
export interface AiProfilesChange {
  /** Set when a profile has just become unusable without the user asking (auto test or a task). */
  failed?: { profileId: string; name: string; source: ProfileCheckSource; message: string };
}
/** Profiles or their health changed (a test started/finished, a task saw an API answer). */
export const aiProfilesChangedEvent = defineEvent<AiProfilesChange>('aiProfiles:changed');
export const menuOpenSettingsEvent = defineEvent<void>('menu:openSettings');
export const menuToggleLeftSidebarEvent = defineEvent<void>('menu:toggleLeftSidebar');

// renderer → main (fire-and-forget; keystrokes should not wait for an invoke round-trip)
export const ptyInputEvent = defineEvent<{ taskId: string; ptyId: string; data: string }>('pty:input');
export const ptyResizeEvent = defineEvent<{ taskId: string; ptyId: string; cols: number; rows: number }>('pty:resize');

/** Voice settings/registration changes only; never voice content. */
export const voiceStatusChangedEvent = defineEvent<void>('voice:changed');
/** Global invocation failures must also be visible inside SmartDD; no input or audio content. */
export const voiceGlobalErrorEvent = defineEvent<VoiceError>('voice:global-error');

export const fileViewerUiEvent = defineEvent<ViewerUiEvent>('files:viewer-ui');
