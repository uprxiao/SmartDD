import assert from 'node:assert/strict';

// Match the real AgentTaskService snapshot/store active turn contract. An
// accepted turn is still in progress even before run.busy becomes true.
const activeStates=new Set(['accepted','dispatching','started','queued']);
const failures=new Set(['failed','stopped','limited','needs_attention']);
export function snapshotSettled(s){
  assert(Array.isArray(s.turns));
  return !s.turns.some(t=>activeStates.has(t.status))&&s.queuedTotal===0&&
    !s.preparingTurnId&&!s.stopping&&!s.run?.busy&&s.status!=='working';
}
export function warmOutcome(s,{seen,answer,localReceipt}){
  const added=s.turns.filter(t=>!seen.has(t.turn_id));
  if(!snapshotSettled(s))return {pending:true};
  if(failures.has(s.status)&&added.length)return {failed:true,status:s.status,turns:added.map(t=>({turnId:t.turn_id,status:t.status,errorCode:t.error_code??null,nativeTurnId:t.native_turn_id??null}))};
  if(s.status!=='completed'||added.length!==1||added[0].status!=='completed'||!added[0].native_turn_id||!localReceipt)return {pending:true};
  if(!s.items?.some(i=>i.payload?.text===answer))return {pending:true};
  return {completed:true,turnId:added[0].turn_id,nativeTurnId:added[0].native_turn_id,runId:added[0].run_id??null};
}
