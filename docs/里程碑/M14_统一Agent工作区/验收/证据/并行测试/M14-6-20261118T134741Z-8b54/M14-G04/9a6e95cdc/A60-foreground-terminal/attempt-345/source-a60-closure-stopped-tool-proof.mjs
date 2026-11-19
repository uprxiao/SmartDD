import assert from 'node:assert/strict';

export function assertRetainedStoppedTool(before, after) {
  assert(before && after, 'Missing one real native tool body');
  assert.equal(before.type, 'command_execution');
  assert.equal(before.terminal, null);
  assert.equal(after.terminal, 'unconfirmed', 'Stopped foreground has no result, not merely a stopped turn');
  for (const key of ['itemId','turnId','type','revision','body','bodySha256'])
    assert.equal(after[key], before[key], 'Native tool identity or partial payload changed: ' + key);
  const payload = JSON.parse(before.body);
  assert.equal(payload.status, 'running', 'Retain the last native payload without writing a fake completion');
  assert.equal(JSON.parse(after.body).status, 'running');
}

export function assertStoppedToolUi(evidence, marker) {
  assert.equal(evidence.rows.length, 1, 'Expected one matching visible real command work row');
  assert.match(evidence.heading, /你在.*秒后停止了/);
  const row = evidence.rows[0];
  assert(row.label.includes(marker), 'Different command is not a visual witness');
  assert.match(row.label, /^未收到工具结果(?: · |$)/);
  assert.doesNotMatch(row.label, /正在运行|正在调用|运行失败|已拒绝运行/);
  assert(row.unconfirmed && !row.running, 'Visible tool row has the wrong effective state');
}
