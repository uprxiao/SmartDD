import assert from 'node:assert/strict';
export function resumeReadiness(v, {ptyId, nativeId, cwd, runId, startedAt}, rows, observedAt = Date.now()) {
 const after = Date.parse(startedAt); assert(runId && Number.isFinite(after) && Number.isFinite(observedAt));
 const metas = rows.filter(r => r.type === 'session_meta').map(r => r.payload);
 if (metas.length !== 1 || metas[0].id !== nativeId || metas[0].cwd !== cwd || metas[0].cli_version !== '0.166.0') return null;
 const event = rows.findLast(r => r.type === 'event_msg' && r.payload?.type === 'thread_settings_applied' && r.payload.thread_id === nativeId && r.payload.thread_settings && Date.parse(r.timestamp) >= after && Date.parse(r.timestamp) <= observedAt);
 if (!event || v?.ptyId !== ptyId || !v.viewportAtBottom || !v.focused || !v.activeInExactTerminal || !v.activeClass?.includes('xterm-helper-textarea')) return null;
 if (!/^\s*›\s+Ask Codex to do anything\s*$/m.test(v.currentScreen) || /^\s*Resuming session(?:…|\.{3})\s*$/m.test(v.currentScreen)) return null;
 return {runId, runStartedAt: startedAt, ptyId, nativeSessionId: nativeId, cwd, settingsAt: event.timestamp, observedAt: new Date(observedAt).toISOString(), source: 'exact-current-bottom-viewport+fresh-native-settings'};
}
