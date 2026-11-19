export const profileControl = name => '.agent-picker .agent-picker-rail button[aria-label='+JSON.stringify(name)+']';
export const modelControl = name => '.agent-picker .agent-model-row[aria-label='+JSON.stringify(name)+']';

export function readSwitchBoundary(snapshot) {
  return {status:snapshot.status,busy:snapshot.run?.busy??false,runId:snapshot.run?.runId??null,
    profileId:snapshot.selection?.profileId,pendingSwitch:snapshot.selection?.pendingSwitch??null,
    switching:!!snapshot.switching,queued:(snapshot.queued??[]).map(turn=>turn.turnId),
    openTurns:snapshot.turns.filter(turn=>['accepted','dispatching','started'].includes(turn.status))
      .map(({turn_id,status})=>({turnId:turn_id,status}))};
}
