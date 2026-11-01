import test from 'node:test';
import assert from 'node:assert/strict';
import { initialIntegrationState, projectIntegrationState, selectProjectMailConnection } from '../src/integration-model.mjs';
import { senderIdentity, confirmSenderIdentity, runPlanForApp, adapterLevels, mailCapabilityRows, mailboxOf } from '../src/m11-preview-model.mjs';

const P = 'ais';
const smtp = (over = {}) => ({ id: 'smtp-1', app: 'mail', kind: 'smtp', name: '公司发件', host: 'smtp.example.invalid', port: 465, account: 'login', fromAddress: 'work@example.invalid', credentialPresent: true, enabled: true, validation: 'ready', revision: 1, ...over });
const base = (smtpOver) => {
  let state = projectIntegrationState({ ...initialIntegrationState(), connections: [...initialIntegrationState().connections, smtp(smtpOver)] });
  state = selectProjectMailConnection(state, P, 'smtp', 'smtp-1');
  return state;
};

test('mailboxOf only accepts mailbox-shaped values and lowercases them', () => {
  assert.equal(mailboxOf(' Work@Example.INVALID '), 'work@example.invalid');
  assert.equal(mailboxOf('合成账号目录'), null);
  assert.equal(mailboxOf(undefined), null);
});

test('no SMTP: cannot send, reading and drafts are unaffected', () => {
  const state = projectIntegrationState(initialIntegrationState());
  const id = senderIdentity(state, P);
  assert.equal(id.status, 'no-smtp'); assert.equal(id.sendAllowed, false);
  const rows = mailCapabilityRows(state, P);
  assert.equal(rows.find(r => r.id === 'send').ok, false);
  assert.equal(rows.find(r => r.id === 'draft').ok, true);
  assert.equal(rows.find(r => r.id === 'query-send').ok, true);
});

test('mailbox directory matching the from address auto-confirms (case-insensitive)', () => {
  const id = senderIdentity(base({ fromAddress: 'Work@Example.Invalid' }), P);
  assert.equal(id.status, 'auto'); assert.equal(id.sendAllowed, true);
});

test('mailbox directory that differs is rejected and cannot be overridden by confirmation', () => {
  const state = base({ fromAddress: 'other@example.invalid' });
  assert.equal(senderIdentity(state, P).status, 'mismatch');
  const after = confirmSenderIdentity(state, P);
  assert.deepEqual(after, state, 'confirmation must not change state on mismatch');
  assert.equal(senderIdentity(after, P).sendAllowed, false);
});

test('SMTP only (no Foxmail): needs user confirmation, then confirmed', () => {
  let state = base();
  state = selectProjectMailConnection(state, P, 'local', '');
  const before = senderIdentity(state, P);
  assert.equal(before.status, 'needs-confirm'); assert.equal(before.sendAllowed, false);
  state = confirmSenderIdentity(state, P);
  const after = senderIdentity(state, P);
  assert.equal(after.status, 'confirmed'); assert.equal(after.sendAllowed, true);
});

test('non-mailbox Foxmail directory needs confirmation', () => {
  const state = base();
  assert.equal(senderIdentity(state, P, 'non-mailbox').status, 'needs-confirm');
});

test('confirmation is invalidated when the bound SMTP revision or Foxmail selection changes', () => {
  let state = selectProjectMailConnection(base(), P, 'local', '');
  state = confirmSenderIdentity(state, P);
  assert.equal(senderIdentity(state, P).status, 'confirmed');
  // SMTP revision bump
  const bumped = { ...state, connections: state.connections.map(c => c.id === 'smtp-1' ? { ...c, revision: 2 } : c) };
  assert.equal(senderIdentity(bumped, P).status, 'invalidated');
  assert.equal(senderIdentity(bumped, P).sendAllowed, false);
  // from-address change
  const moved = { ...state, connections: state.connections.map(c => c.id === 'smtp-1' ? { ...c, fromAddress: 'new@example.invalid' } : c) };
  assert.equal(senderIdentity(moved, P).status, 'invalidated');
  // selecting Foxmail again makes the binding differ
  const withFox = selectProjectMailConnection(state, P, 'local', 'fox-demo');
  assert.notEqual(senderIdentity(withFox, P).status, 'confirmed');
  // reconfirm works
  assert.equal(senderIdentity(confirmSenderIdentity(bumped, P), P).status, 'confirmed');
});

test('confirmations survive state sanitisation but are dropped when malformed', () => {
  let state = selectProjectMailConnection(base(), P, 'local', '');
  state = confirmSenderIdentity(state, P);
  const reloaded = projectIntegrationState(JSON.parse(JSON.stringify(state)));
  assert.equal(senderIdentity(reloaded, P).status, 'confirmed');
  const broken = projectIntegrationState({ ...JSON.parse(JSON.stringify(state)), senderConfirmations: { [P]: { binding: { smtpId: 5 } }, 'bad key!': {} } });
  assert.deepEqual(broken.senderConfirmations, {});
});

test('mail capability rows follow slots; reply needs Foxmail, drafts and resources do not', () => {
  let state = selectProjectMailConnection(base(), P, 'local', '');
  const rows = id => Object.fromEntries(mailCapabilityRows(state, P).map(r => [r.id, r.ok]));
  assert.equal(rows().read, false); assert.equal(rows().reply, false);
  assert.equal(rows().resource, true); assert.equal(rows().draft, true); assert.equal(rows()['query-send'], true);
  assert.equal(rows().send, false, 'SMTP only needs user confirmation before sending');
  state = confirmSenderIdentity(state, P);
  assert.equal(rows().send, true);
});

test('run plan: mail is always MCP; zentao uses CLI when declared, read-only fallback MCP otherwise', () => {
  for (const s of ['declared', 'fallback', 'sandbox']) { const m = runPlanForApp('mail', s); assert.equal(m.active, 'mcp'); assert.equal(m.degraded, false); assert.equal(m.available, true); }
  const ok = runPlanForApp('zentao', 'declared'); assert.equal(ok.active, 'cli'); assert.equal(ok.degraded, false);
  for (const s of ['fallback', 'sandbox']) { const z = runPlanForApp('zentao', s); assert.equal(z.active, 'mcp'); assert.equal(z.degraded, true); assert.ok(z.reason); }
  assert.equal(runPlanForApp('unknown', 'declared'), null);
});

test('adapter levels: original review state stays closed; undeclared versions do not get CLI', () => {
  const by = scenario => Object.fromEntries(adapterLevels(scenario).map(l => [l.level, l.state]));
  assert.equal(by('declared')['L0.cli'], 'declared');
  assert.equal(by('declared').L2, 'unverified'); assert.equal(by('declared').L3, 'unverified');
  for (const s of ['fallback', 'sandbox']) { assert.equal(by(s)['L0.cli'], 'unverified'); assert.equal(by(s)['L0.skill'], 'best-effort'); assert.equal(by(s).L3, 'unverified'); }
});

test('S10 increment declares L2 without enabling chat authorization or switching entries', () => {
  const by = Object.fromEntries(adapterLevels('l2').map(l => [l.level, l.state]));
  assert.equal(by.L2, 'declared');
  assert.equal(by.L3, 'unverified');
  assert.equal(runPlanForApp('zentao', 'l2').active, 'cli');
  assert.equal(runPlanForApp('mail', 'l2').active, 'mcp');
});

test('D08 matching automatic identity invalidates on source switches, switch-back and SMTP revision changes', () => {
  const initial=base(), a=initial.connections.find(c=>c.id==='fox-demo');
  const withB={...initial,connections:[...initial.connections,{...a,id:'fox-second',name:'same mailbox other source'}]};
  const switched=selectProjectMailConnection(withB,P,'local','fox-second');
  assert.equal(senderIdentity(switched,P).status,'invalidated');assert.equal(senderIdentity(switched,P).sendAllowed,false);
  const returned=selectProjectMailConnection(switched,P,'local','fox-demo');assert.equal(senderIdentity(returned,P).status,'invalidated');
  assert.equal(senderIdentity(confirmSenderIdentity(returned,P),P).status,'auto');
  const bumped={...initial,connections:initial.connections.map(c=>c.id==='smtp-1'?{...c,revision:2}:c)};assert.equal(senderIdentity(bumped,P).status,'invalidated');
});
