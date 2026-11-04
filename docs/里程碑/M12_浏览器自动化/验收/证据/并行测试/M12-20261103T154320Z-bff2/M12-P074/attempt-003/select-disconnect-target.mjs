import assert from 'node:assert/strict';
export const candidateSql="SELECT b.*,i.operation_id AS invocation_id,i.tool_name AS invocation_tool,i.state AS invocation_state,i.attempt_count AS invocation_attempt_count FROM browser_operations b JOIN application_invocations i ON i.run_id=b.run_id AND i.request_id=b.request_id WHERE b.run_id=? AND b.page_id=? AND b.command='find' AND b.state='running' AND i.tool_name='browser.interact.find' AND i.state='running'";
export function selectDisconnectTarget(rows,peers,runId,pageId){
 assert.equal(rows.length,1,'Need unique real joined running write');const record=rows[0];
 assert.equal(record.run_id,runId);assert.equal(record.page_id,pageId);assert.equal(record.command,'find');assert.equal(record.state,'running');assert.equal(record.invocation_tool,'browser.interact.find');assert.equal(record.invocation_state,'running');assert.equal(record.invocation_attempt_count,1);assert.match(record.request_id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
 const matches=[...peers].filter(peer=>peer.authenticatedRun===runId&&peer.socket.destroyed===false&&peer.controllers.get(record.request_id)?.runId===runId);
 assert.equal(matches.length,1,'Need unique authenticated actual CLI peer');return{record,peer:matches[0]};
}
