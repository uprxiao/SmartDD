// Controls use frozen, already-completed A003 records only. No process/network/UI/auth operations.
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {collectTypedPrimaryReceipts, deriveTypedPrimaryReceipts} from './typed-primary-recorder.mjs';
const root = '/private/tmp/willyou-m12-t105-typed-primary-recorder-001';
const rawPath = '/private/tmp/willyou-m12-t105-App025-A-R-003/raw.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const rawBytes = await readFile(rawPath), raw = JSON.parse(rawBytes), journal = raw.phases[0].journals[0];
const hostBytes = await readFile(root + '/A003-Host-readonly.safe.json'), hostEvidence = JSON.parse(hostBytes);
const hostInvocations = hostEvidence.rows, plan = raw.actualPlan;
const expected = {cwd: journal.session.cwd, nativeSessionId: raw.nativeSessionId, runId: raw.runId, taskId: raw.taskId, projectId: raw.projectId, turnId: journal.contexts[0].turnId, after: raw.phases[0].after};
const base = {journal, expected, hostInvocations, plan};
const journalBefore = JSON.stringify(journal), planBefore = JSON.stringify(plan);
const result = await collectTypedPrimaryReceipts(base);
const prefix = (await readFile(journal.source.path)).subarray(0, journal.source.bytes);
const rows = prefix.toString('utf8').trimEnd().split('\n').map(JSON.parse);
const targets = [{line: 23, capabilityId: 'browser.tab.list'}, {line: 28, capabilityId: 'browser.tab.create'}];
const checks = [];
for (const target of targets) {
  const matches = result.receipts.filter(receipt => receipt.line === target.line && receipt.value.capabilityId === target.capabilityId);
  assert.equal(matches.length, 1); assert.equal(matches[0].childExitCodeObserved, 0);
  assert.equal(matches[0].originalParserReceipt, null); assert.equal(matches[0].typedCommandExitProof.outerCarrierDecoded, false);
  checks.push({name: 'A003-real-positive-' + target.capabilityId, pass: true, line: target.line, actualNumericExit: matches[0].childExitCodeObserved});
}
assert.equal(result.receipts.length, 2); assert.deepEqual(result.failures, []);
assert.equal(result.originalParserDiagnostics.unsupportedCarriers.length, 2);
assert.equal(result.originalParserReceipts.length, 0);
assert(result.outerRecords.some(record => record.line === 21) && result.outerRecords.some(record => record.line === 26));
const firstOperation = result.receipts[0].value.operation.id;
for (const [name, mutate] of [
  ['wrong-identity', next => { next[22].payload.thread_id = 'different-native-session'; }],
  ['wrong-numeric-exit', next => { next[22].payload.item.exit_code = 1; }],
  ['wrong-status', next => { next[22].payload.item.status = 'in_progress'; }],
  ['duplicate-operation', next => { next.splice(23, 0, structuredClone(next[22])); }],
  ['wrong-operation', next => { const value = JSON.parse(next[22].payload.item.aggregated_output); value.operation.id = 'different-host-operation'; next[22].payload.item.aggregated_output = JSON.stringify(value); }]
]) {
  const altered = structuredClone(rows); mutate(altered);
  const control = deriveTypedPrimaryReceipts({...base, rows: altered});
  assert(!control.receipts.some(receipt => receipt.value.capabilityId === 'browser.tab.list'), name + ' must never gain a zero-exit receipt');
  assert.equal(control.receipts.filter(receipt => receipt.value.capabilityId === 'browser.tab.create').length, 1, 'unaffected actual create remains independently proven');
  assert(control.failures.length >= 1);
  checks.push({name, pass: true, controlOnly: true, rejectedTargetOperation: firstOperation, rejectedCount: control.failures.length, reasons: control.failures.map(failure => failure.reason)});
}
assert.equal(JSON.stringify(journal), journalBefore); assert.equal(JSON.stringify(plan), planBefore);
assert.equal(sha(await readFile(rawPath)), sha(rawBytes), 'original raw changed');
const safe = {
  schema: 'A003-native-typed-primary-positive-safe-v1', fileOnly: true, formalNewPasses: 0,
  sourceRaw: {path: rawPath, sha256: sha(rawBytes), bytes: rawBytes.length},
  sourceJournal: journal.source,
  hostEvidence: {path: root + '/A003-Host-readonly.safe.json', sha256: sha(hostBytes), rows: hostInvocations.length},
  expected, planHash: plan.planHash,
  originalParser: {receipts: journal.receipts.length, unsupportedCarriers: journal.unsupportedCarriers.length, originalUnmodified: true},
  receipts: result.receipts.map(receipt => ({provenance: receipt.provenance, source: receipt.source, line: receipt.line, at: receipt.at, capabilityId: receipt.value.capabilityId, operationId: receipt.value.operation.id, requestId: receipt.value.operation.requestId, childExitCodeObserved: receipt.childExitCodeObserved, originalParserReceipt: null, typedCommandExitProof: receipt.typedCommandExitProof})),
  diagnostics: result.diagnostics, failures: result.failures,
  completeOuterRecordCount: result.outerRecords.length, wholeOuterRecordsRemainInOriginalPrivateSource: true,
  modelCodeEvaluated: false, originalTenBusinessJudgesUnmodified: true,
  boundary: 'Saved A003 first-phase CLI receipts only; does not complete T105, replace failed attempts or assert the missing second UI/R phase.'
};
await writeFile(root + '/A003-typed-primary.safe.json', JSON.stringify(safe, null, 2) + '\n');
await writeFile(root + '/controls-result.json', JSON.stringify({schema: 'typed-primary-controls-v1', source: safe.sourceRaw, journal: journal.source, checks, passed: checks.filter(check => check.pass).length, total: checks.length, originalRawAndParserUnmodified: true, noNativeOrModelExecution: true, formalNewPasses: 0}, null, 2) + '\n');
console.log(JSON.stringify({passed: checks.length, total: checks.length, actualReceipts: result.receipts.length, actualNumericExits: result.receipts.map(receipt => receipt.childExitCodeObserved), originalUnsupportedRetained: result.originalParserDiagnostics.unsupportedCarriers.length, originalRawUnmodified: true, formalNewPasses: 0}));
