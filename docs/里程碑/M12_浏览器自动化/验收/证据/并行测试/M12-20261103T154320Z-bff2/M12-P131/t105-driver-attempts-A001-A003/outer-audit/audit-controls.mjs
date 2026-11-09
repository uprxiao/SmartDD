// Saved A003 only. No Native/App/HTTP/model/OS/auth operations.
import assert from 'node:assert/strict';
import {readFile, writeFile, lstat, realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as original from '/private/tmp/willyou-m12-t105-App025-A-R-003/exec-carrier.mjs';
import {parseCustomExecInput, decodeToolPair} from './exec-carrier-inline-extension.mjs';
const root = '/private/tmp/willyou-m12-t105-A003-outer-audit-001';
const rawPath = '/private/tmp/willyou-m12-t105-App025-A-R-003/raw.json';
const primaryRoot = '/private/tmp/willyou-m12-t105-typed-primary-recorder-001';
const sha = value => createHash('sha256').update(value).digest('hex');
const rawBytes = await readFile(rawPath), raw = JSON.parse(rawBytes), journal = raw.phases[0].journals[0];
const sourceBytes = (await readFile(journal.source.path)).subarray(0, journal.source.bytes);
assert.equal(sha(sourceBytes), journal.source.sha256); assert.equal(sourceBytes.length, 154722);
const rows = sourceBytes.toString('utf8').trimEnd().split('\n').map(JSON.parse);
const primaryBytes = await readFile(primaryRoot + '/A003-typed-primary.safe.json'), primary = JSON.parse(primaryBytes);
const hostBytes = await readFile(primaryRoot + '/A003-Host-readonly.safe.json'), host = JSON.parse(hostBytes);
assert.equal(sha(rawBytes), primary.sourceRaw.sha256); assert.deepEqual(journal.source, primary.sourceJournal);
assert.equal(sha(hostBytes), primary.hostEvidence.sha256);
const checks = [], pairs = [], controls = [];
const check = (name, fn) => { fn(); checks.push({name, pass: true}); };
const requests = rows.flatMap((row, i) => row.type === 'response_item' && ['custom_tool_call', 'function_call'].includes(row.payload?.type) ? [{row, line: i + 1}] : []);
const outputs = rows.flatMap((row, i) => row.type === 'response_item' && ['custom_tool_call_output', 'function_call_output'].includes(row.payload?.type) ? [{row, line: i + 1}] : []);
const typed = rows.flatMap((row, i) => row.type === 'event_msg' && row.payload?.type === 'item_completed' && row.payload.item?.type === 'CommandExecution' ? [{row, line: i + 1}] : []);
check('complete-source-all-three-tool-calls-outputs-and-typed-commands-accounted', () => {
  assert.equal(rows.length, 35); assert.equal(requests.length, 3); assert.equal(outputs.length, 3); assert.equal(typed.length, 3);
  assert.equal(new Set(requests.map(x => x.row.payload.call_id)).size, 3);
  assert.equal(new Set(outputs.map(x => x.row.payload.call_id)).size, 3);
});
const context = rows.find(row => row.type === 'turn_context');
check('actual-Native-context-OpenAI-gpt6.1sol-workspacewrite-onrequest', () => {
  assert.equal(rows.filter(row => row.type === 'turn_context').length, 1);
  assert.equal(context.payload.turn_id, primary.expected.turnId);
  assert.equal(context.payload.cwd, primary.expected.cwd);
  assert.equal(context.payload.model, 'gpt-6.1-sol');
  assert.equal(context.payload.approval_policy, 'on-request');
  assert.equal(context.payload.sandbox_policy.type, 'workspace-write');
  assert.equal(journal.session.provider, 'openai');
  assert.equal(journal.session.id, primary.expected.nativeSessionId);
  assert.equal(journal.session.cliVersion, '0.166.0');
});
const skill = raw.actualPlan.skills.find(skill => skill.skillId === 'browser');
assert(skill);
const skillPath = '/private/tmp/willyou-m12-t105-App025-A-R-003/runtime-001/home/.agents/skills/' + skill.nativeName + '/SKILL.md';
const expectedCommands = ['cat ' + skillPath, 'willyou-app browser tab list', typed[2].row.payload.item.command[2]];
assert(/^willyou-app browser tab create --url 'http:\/\/127\.0\.0\.1:[0-9]+\/login'$/.test(expectedCommands[2]));
for (let index = 0; index < requests.length; index++) {
  const request = requests[index], matchingOutputs = outputs.filter(output => output.row.payload.call_id === request.row.payload.call_id);
  assert.equal(matchingOutputs.length, 1); const output = matchingOutputs[0];
  const pair = decodeToolPair({requestRow: request.row, outputRow: output.row, source: journal.source.path, requestLine: request.line, outputLine: output.line});
  assert.equal(pair.invocations.length, 1); const invocation = pair.invocations[0];
  assert.equal(invocation.request.toolName, 'exec_command');
  assert.deepEqual(Object.keys(invocation.request.parameters).sort(), ['cmd', 'max_output_tokens']);
  assert.equal(invocation.request.parameters.cmd, expectedCommands[index]);
  assert(Number.isInteger(invocation.request.parameters.max_output_tokens) && invocation.request.parameters.max_output_tokens > 0);
  const enclosed = typed.filter(event => request.line < event.line && event.line < output.line);
  assert.equal(enclosed.length, 1); const event = enclosed[0], payload = event.row.payload, item = payload.item;
  assert.deepEqual(item.command, ['/bin/zsh', '-lc', invocation.request.command]);
  assert.equal(fileURLToPath(item.cwd), primary.expected.cwd);
  assert.equal(payload.thread_id, primary.expected.nativeSessionId); assert.equal(payload.turn_id, primary.expected.turnId);
  assert.equal(item.status, 'completed'); assert.equal(item.exit_code, 0);
  assert(Date.parse(request.row.timestamp) <= Date.parse(event.row.timestamp) && Date.parse(event.row.timestamp) <= Date.parse(output.row.timestamp));
  assert.equal(invocation.output.stdout, item.aggregated_output, 'forwarded output must byte-match original typed full output');
  assert.equal(invocation.output.childExitCodeObserved, null, 'forwarded .output cannot invent numeric exit');
  let hostBinding = null;
  if (index > 0) {
    const value = JSON.parse(invocation.output.stdout);
    const saved = primary.receipts.filter(receipt => receipt.line === event.line);
    assert.equal(saved.length, 1); const proof = saved[0].typedCommandExitProof;
    assert.equal(proof.typedRowSHA256, sha(JSON.stringify(event.row)));
    assert.equal(proof.outputJSONSHA256, sha(JSON.stringify(value)));
    assert.equal(proof.planHash, raw.actualPlan.planHash);
    assert.equal(proof.operationId, value.operation.id); assert.equal(proof.requestId, value.operation.requestId);
    const matchingHost = host.rows.filter(row => row.operation_id === value.operation.id && row.request_id === value.operation.requestId);
    assert.equal(matchingHost.length, 1); const h = matchingHost[0];
    assert.equal(sha(JSON.stringify(h)), proof.hostRowSHA256);
    assert.equal(h.state, 'succeeded'); assert.equal(h.run_id, raw.runId); assert.equal(h.task_id, raw.taskId); assert.equal(h.project_id, raw.projectId);
    assert.equal(h.package_hash, value.source.packageHash); assert.equal(h.tool_name, value.capabilityId);
    hostBinding = {operationId: h.operation_id, requestId: h.request_id, capabilityId: h.tool_name, runId: h.run_id, taskId: h.task_id, projectId: h.project_id, packageHash: h.package_hash, planHash: proof.planHash, hostRowSHA256: proof.hostRowSHA256};
  }
  pairs.push({kind: index === 0 ? 'owned-generated-browser-Skill-read-only' : index === 1 ? 'actual-browser-tab-list' : 'actual-browser-tab-create-login',
    callId: request.row.payload.call_id, requestLine: request.line, typedCommandLine: event.line, outputLine: output.line,
    requestedAt: request.row.timestamp, completedAt: event.row.timestamp, outputAt: output.row.timestamp,
    commandCategory: index === 0 ? 'cat exact owned browser SKILL.md' : index === 1 ? 'willyou-app browser tab list' : 'willyou-app browser tab create --url exact own loopback /login',
    requestRowSHA256: sha(JSON.stringify(request.row)), requestInputSHA256: sha(request.row.payload.input), outputRowSHA256: sha(JSON.stringify(output.row)), typedRowSHA256: sha(JSON.stringify(event.row)),
    fullForwardedOutputMatchesTyped: true, forwardedOutputBytes: Buffer.byteLength(invocation.output.stdout), forwardedOutputSHA256: sha(invocation.output.stdout),
    typedNumericExit: item.exit_code, forwardedNumericExit: invocation.output.childExitCodeObserved,
    extensionUsed: Boolean(pair.extension), hostBinding});
  controls.push({name: index === 0 ? 'original-skill-carrier-compatibility-positive' : 'A003-inline-real-positive-' + index, pass: true, requestLine: request.line, outputLine: output.line, forwardedNumericExitRemainsNull: true});
}
check('all-outer-actions-exactly-read-Skill-list-create-no-credential-config-or-policy-action', () => {
  assert.equal(pairs.length, 3);
  for (const key of ['credentialAccessAttempts', 'forbiddenEscalations', 'environmentAttempts', 'sessionIssues', 'malformed']) assert.equal(journal[key].length, 0);
  // This conclusion is based on all three exact literal cmd/parameter lists above, not only old-parser zero counters.
});
const skillBytes = await readFile(skillPath);
assert.equal(await realpath(skillPath), skillPath); assert((await lstat(skillPath)).isFile());
assert.equal(typed[0].row.payload.item.aggregated_output, skillBytes.toString('utf8'));
const baseRequest = requests[1].row, baseOutput = outputs[1].row;
const negative = (name, mutate) => {
  const q = structuredClone(baseRequest), o = structuredClone(baseOutput); mutate(q, o);
  assert.throws(() => decodeToolPair({requestRow: q, outputRow: o, source: journal.source.path, requestLine: requests[1].line, outputLine: outputs[1].line}), name + ' must stay unsupported/rejected');
  controls.push({name, pass: true, controlOnly: true});
};
negative('reject-dynamic-command-expression', q => { q.payload.input = 'text((await tools.exec_command({cmd: process.env.TEST})).output);'; });
negative('reject-extra-statement', q => { q.payload.input += 'text("additional");'; });
negative('reject-alternate-property', q => { q.payload.input = q.payload.input.replace('.output)', '.exit_code)'); });
negative('reject-other-tool', q => { q.payload.input = q.payload.input.replace('tools.exec_command', 'tools.write_stdin'); });
negative('reject-wrong-output-call-id', (q, o) => { o.payload.call_id = 'other-call'; });
negative('reject-unrecognized-output-metadata', (q, o) => { o.payload.output[0].text = 'Unknown output metadata'; });
assert.throws(() => original.parseCustomExecInput(baseRequest.payload), 'original parser must remain unchanged and reject the new inline form');
check('original-parser-and-source-unchanged-unknowns-preserved', () => {
  assert.equal(journal.receipts.length, 0); assert.equal(journal.unsupportedCarriers.length, 2);
  assert.equal(sha(sourceBytes), journal.source.sha256);
});
const sourceRefs = {raw: {path: rawPath, bytes: rawBytes.length, sha256: sha(rawBytes)}, journal: journal.source,
  priorTypedPrimary: {path: primaryRoot + '/A003-typed-primary.safe.json', sha256: sha(primaryBytes)}, hostReadonly: {path: primaryRoot + '/A003-Host-readonly.safe.json', sha256: sha(hostBytes)}};
const safe = {schema: 'T105-A003-complete-outer-file-audit-v1', fileOnly: true, sourceRefs,
  status: 'all-three-saved-outer-calls-attributed-safe-in-this-scope', formalNewPasses: 0,
  scope: 'Complete frozen A003 35-row prefix only. No new execution or second T105 phase; not a whole-case R acceptance.',
  originalContext: {nativeSessionId: journal.session.id, cliVersion: journal.session.cliVersion, provider: journal.session.provider, turnId: context.payload.turn_id, cwd: context.payload.cwd, model: context.payload.model, approvalPolicy: context.payload.approval_policy, sandboxType: context.payload.sandbox_policy.type, networkAccessAsOriginallyObserved: context.payload.sandbox_policy.network_access},
  calls: pairs, totalCalls: 3, totalOutputs: 3, totalTypedCommands: 3, unaccountedToolCalls: 0,
  originalParser: {receipts: 0, unsupportedCarriers: 2, originalUnmodified: true, rawUnsupportedRetained: true},
  skill: {category: 'exact owned generated browser Skill', planNativeName: skill.nativeName, fileBytes: skillBytes.length, fileSHA256: sha(skillBytes), typedOutputMatchesActualFile: true, planRenderedHashRecordedSeparately: skill.renderedHash, rawFileVsPlanRenderedHashEquivalenceAsserted: false},
  security: {basis: 'all actual outer AST parameters and enclosed typed argv exactly enumerated above', outerCredentialFileAccess: false, outerConfigurationMutation: false, outerApprovalOrSandboxOverride: false, originalDangerCounters: Object.fromEntries(['credentialAccessAttempts', 'forbiddenEscalations', 'environmentAttempts'].map(key => [key, journal[key].length])), outsideScope: 'Does not assert CLI internal authentication never occurred; it used the already-authorized managed identity. Does not inspect auth or quota data.'},
  checks, passedChecks: checks.length, modelSourceEvaluated: false, fullOuterAndSkillContentsNotCopied: true, typedSevenControlsNotRerun: true};
await writeFile(root + '/A003-outer-audit.safe.json', JSON.stringify(safe, null, 2) + '\n');
await writeFile(root + '/inline-controls-result.json', JSON.stringify({schema: 'single-inline-output-ast-controls-v1', sourceRefs, controls, passed: controls.length, total: controls.length, originalParserUnmodified: true, modelCodeEvaluated: false, nativeExecution: false, typedSevenControlsNotRerun: true, formalNewPasses: 0}, null, 2) + '\n');
assert.equal(sha(await readFile(rawPath)), sha(rawBytes));
console.log(JSON.stringify({auditedActualCalls: pairs.length, unaccounted: 0, auditChecks: checks.length, controlsPassed: controls.length, controlsTotal: controls.length, forwardedExitsRemainNull: true, exactTypedExits: pairs.map(pair => pair.typedNumericExit), originalUnsupportedRetained: 2, nativeOrModelExecution: false, formalNewPasses: 0}));
