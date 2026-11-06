import assert from 'node:assert/strict';

// Same 003 acceptance predicates; expose every rejection instead of losing null.
export function explainResumeReadiness(v,{ptyId,nativeId,cwd,runId,startedAt},rows,observedAt=Date.now()){
 const after=Date.parse(startedAt);assert(runId&&Number.isFinite(after)&&Number.isFinite(observedAt));
 const metas=rows.filter(r=>r.type==='session_meta').map(r=>r.payload);
 const events=rows.filter(r=>r.type==='event_msg'&&r.payload?.type==='thread_settings_applied'&&r.payload.thread_id===nativeId&&r.payload.thread_settings);
 const event=events.findLast(r=>Date.parse(r.timestamp)>=after&&Date.parse(r.timestamp)<=observedAt);
 const predicates={
  singleNativeMeta:metas.length===1,
  exactNativeId:metas.length===1&&metas[0].id===nativeId,
  exactCwd:metas.length===1&&metas[0].cwd===cwd,
  exactCliVersion:metas.length===1&&metas[0].cli_version==='0.166.0',
  freshExactRunSettings:!!event,
  exactPty:v?.ptyId===ptyId,
  viewportAtBottom:!!v?.viewportAtBottom,
  documentFocused:!!v?.focused,
  activeInExactTerminal:!!v?.activeInExactTerminal,
  activeTextarea:!!v?.activeClass?.includes('xterm-helper-textarea'),
  exactPlaceholderLine:/^\s*›\s+Ask Codex to do anything\s*$/m.test(v?.currentScreen??''),
  noVisibleResumeLine:!/^\s*Resuming session(?:…|\.{3})\s*$/m.test(v?.currentScreen??''),
 };
 const rejectReasons=Object.entries(predicates).filter(([,passed])=>!passed).map(([reason])=>reason);
 const ready=rejectReasons.length?null:{runId,runStartedAt:startedAt,ptyId,nativeSessionId:nativeId,cwd,settingsAt:event.timestamp,observedAt:new Date(observedAt).toISOString(),source:'exact-current-bottom-viewport+fresh-native-settings'};
 return {predicates,rejectReasons,ready,native:{rowCount:rows.length,metas:metas.map(m=>({id:m.id,cwd:m.cwd,cli_version:m.cli_version})),matchingSettingsCount:events.length,latestMatchingSettingsAt:events.at(-1)?.timestamp??null,acceptedSettingsAt:event?.timestamp??null},observedAt:new Date(observedAt).toISOString()};
}
export function resumeReadiness(...args){return explainResumeReadiness(...args).ready;}
