// File-only primary recorder. Does not import/evaluate the outer-JS carrier parser.
import assert from 'node:assert/strict';
import {readFile, lstat, realpath} from 'node:fs/promises';
import {resolve, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const sha = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const nonempty = value => typeof value === 'string' && value.length > 0;
function cwdPath(value) {
  assert(nonempty(value), 'cwd must be a nonempty absolute path');
  if (value.startsWith('file:')) {
    const url = new URL(value);
    assert(url.protocol === 'file:' && !url.search && !url.hash && !url.username && !url.password && ['', 'localhost'].includes(url.hostname));
    value = fileURLToPath(url);
  }
  assert(isAbsolute(value) && resolve(value) === value, 'cwd must be canonical in syntax');
  return value;
}

// A deliberately limited literal shell-word reader, never a shell evaluator.
// Compound/expanding commands do not prove a numeric CLI-child exit and stay diagnostic.
function literalWords(text) {
  assert(nonempty(text) && !/[\r\n\0]/.test(text), 'nonliteral shell command');
  const words = []; let word = '', quote = null, active = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") { if (c === "'") quote = null; else word += c; continue; }
    if (quote === '"') {
      if (c === '"') { quote = null; continue; }
      assert(c !== '$' && c !== '`', 'shell expansion not accepted');
      if (c === '\\') { assert(i + 1 < text.length); const next = text[++i]; assert(['\\', '"'].includes(next), 'nonliteral double-quoted escape'); word += next; }
      else word += c;
      continue;
    }
    if (/\s/.test(c)) { if (active) { words.push(word); word = ''; active = false; } continue; }
    if (c === "'" || c === '"') { quote = c; active = true; continue; }
    if (c === '\\') { assert(i + 1 < text.length); word += text[++i]; active = true; continue; }
    assert(!/[;&|<>$`(){}*?\[\]~#]/.test(c), 'shell operator/expansion not accepted');
    word += c; active = true;
  }
  assert(!quote, 'unterminated shell quote');
  if (active) words.push(word);
  assert(words.length > 0);
  return words;
}
function directCliCommand(item, expected) {
  const command = item.command;
  assert(Array.isArray(command) && command.length === 3 && ['/bin/zsh', '/bin/bash'].includes(command[0]) && command[1] === '-lc' && typeof command[2] === 'string', 'not a supported direct CLI shell argv');
  const argv = literalWords(command[2]);
  assert(argv[0] === 'willyou-app' || (nonempty(expected.cliExecutable) && argv[0] === expected.cliExecutable), 'typed command is not the actual direct willyou-app invocation');
  return {command: command[2], shellArgv: copy(command), cliArgv: argv};
}
const parserDiagnosticKeys = ['unsupportedCarriers', 'unsupportedOutputs', 'credentialAccessAttempts', 'forbiddenEscalations', 'duplicateCalls', 'duplicateOutputs', 'sessionIssues', 'unexpectedReceipts', 'malformed', 'unmatchedOutputs', 'pendingCallIds', 'outputBeforeCalls', 'invalidTimestamps', 'environmentAttempts'];

// Pure seam for controls. rows are parsed, unmodified original JSONL records.
export function deriveTypedPrimaryReceipts({journal, rows, expected, hostInvocations, plan}) {
  assert(Array.isArray(rows) && Array.isArray(hostInvocations));
  const diagnostics = [], failures = [], receipts = [], proofs = [];
  const originalParserDiagnostics = Object.fromEntries(parserDiagnosticKeys.map(key => [key, copy(journal[key] ?? [])]));
  const reject = (line, reason, extra = {}) => { const failure = {line, reason, ...extra}; failures.push(failure); diagnostics.push({kind: 'rejected-typed-v2-command', ...failure}); };
  let turns, after, before;
  try {
    for (const key of ['cwd', 'nativeSessionId', 'runId', 'taskId', 'projectId']) assert(nonempty(expected[key]), 'expected.' + key + ' required');
    assert.equal(cwdPath(journal.session.cwd), cwdPath(expected.cwd), 'journal cwd mismatch');
    assert.equal(journal.session.id, expected.nativeSessionId, 'journal Native session mismatch');
    assert.equal(journal.session.cliVersion, '0.166.0', 'CLI version must be the fixed 0.166.0');
    const metas = rows.filter(row => row.type === 'session_meta');
    assert.equal(metas.length, 1, 'unique actual session_meta required');
    assert.equal(metas[0].payload.id, expected.nativeSessionId, 'actual session_meta Native mismatch');
    assert.equal(cwdPath(metas[0].payload.cwd), cwdPath(expected.cwd), 'actual session_meta cwd mismatch');
    assert.equal(metas[0].payload.cli_version, '0.166.0');
    for (const key of ['runId', 'taskId', 'projectId']) assert.equal(plan[key], expected[key], 'plan ' + key + ' mismatch');
    assert.equal(plan.schema, 'willyou-application-run-plan-v1');
    assert(/^[a-f0-9]{64}$/.test(plan.planHash), 'fixed actual planHash required');
    assert.equal(plan.cliVersion, '0.166.0');
    assert(Array.isArray(plan.allowed) && Array.isArray(plan.applications));
    turns = [...new Set((journal.contexts ?? []).map(context => context.turnId).filter(nonempty))];
    if (expected.turnId !== undefined) { assert(nonempty(expected.turnId) && turns.includes(expected.turnId), 'expected turn absent from captured context'); turns = [expected.turnId]; }
    assert.equal(turns.length, 1, 'one exact current turn required; pass expected.turnId for multi-turn journal');
    const contexts = rows.filter(row => row.type === 'turn_context' && row.payload?.turn_id === turns[0]);
    assert(contexts.length > 0, 'actual matching turn_context required');
    for (const context of contexts) assert.equal(cwdPath(context.payload.cwd), cwdPath(expected.cwd), 'actual turn cwd mismatch');
    after = expected.after === undefined ? -Infinity : Date.parse(expected.after);
    before = expected.before === undefined ? Infinity : Date.parse(expected.before);
    assert(!Number.isNaN(after) && !Number.isNaN(before) && after < before, 'invalid expected time scope');
  } catch (error) {
    reject(null, error.message.split('\n')[0], {scope: 'journal-plan-identity'});
    return result();
  }

  const candidates = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index], payload = row.payload, item = payload?.item, line = index + 1;
    if (row.type !== 'event_msg' || payload?.type !== 'item_completed' || item?.type !== 'CommandExecution') continue;
    const at = Date.parse(row.timestamp);
    if (at < after || at > before || !turns.includes(payload.turn_id)) continue;
    let value;
    try { assert(typeof item.aggregated_output === 'string'); value = JSON.parse(item.aggregated_output.trim()); }
    catch { diagnostics.push({kind: 'non-v2-typed-command', line, rowSHA256: sha(JSON.stringify(row))}); continue; }
    if (value?.schema !== 'willyou-app-result-v2') { diagnostics.push({kind: 'non-v2-typed-command', line, rowSHA256: sha(JSON.stringify(row))}); continue; }
    candidates.push({row, payload, item, value, line, at});
  }
  for (const candidate of candidates) {
    const {row, payload, item, value, line, at} = candidate;
    try {
      assert(Number.isFinite(at), 'invalid actual timestamp');
      assert.equal(payload.thread_id, expected.nativeSessionId, 'typed thread/Native mismatch');
      assert.equal(payload.turn_id, turns[0], 'typed turn mismatch');
      assert.equal(cwdPath(item.cwd), cwdPath(expected.cwd), 'typed cwd mismatch');
      assert.equal(item.status, 'completed', 'actual typed status is not completed');
      assert(Number.isInteger(item.exit_code), 'actual typed numeric exit missing');
      assert.equal(item.exit_code, 0, 'actual typed child exit is not zero');
      assert(nonempty(item.id) && /^\d+$/.test(item.process_id), 'actual typed command/process identity missing');
      assert(Number.isFinite(payload.started_at_ms) && Number.isFinite(payload.completed_at_ms) && payload.started_at_ms <= payload.completed_at_ms, 'invalid actual typed execution interval');
      assert.equal(value.contractMajor, 2); assert.equal(value.status, 'ok');
      assert.equal(value.operation?.origin, 'cli');
      assert(nonempty(value.operation?.id) && nonempty(value.operation?.requestId));
      assert(nonempty(value.capabilityId) && nonempty(value.source?.appId) && /^[a-f0-9]{64}$/.test(value.source?.packageHash));
      const sameOperation = candidates.filter(other => other.value.operation?.id === value.operation.id || other.value.operation?.requestId === value.operation.requestId || other.item.id === item.id);
      assert.equal(sameOperation.length, 1, 'ambiguous/duplicate actual typed operation, request or command');
      const matchingPlan = plan.allowed.filter(entry => entry.appId === value.source.appId && entry.capabilityId === value.capabilityId && entry.packageHash === value.source.packageHash && entry.contractMajor === 2 && entry.entry === 'cli');
      assert.equal(matchingPlan.length, 1, 'unique actual allowed CLI plan entry required');
      const application = plan.applications.filter(entry => entry.appId === value.source.appId && entry.packageHash === value.source.packageHash && entry.effectiveEntry === 'cli');
      assert.equal(application.length, 1, 'unique effective CLI application/package required');
      const command = directCliCommand(item, expected), planEntry = matchingPlan[0];
      assert(Array.isArray(planEntry.cliCommand) && planEntry.cliCommand.length > 0);
      assert.deepEqual(command.cliArgv.slice(1, 1 + planEntry.cliCommand.length), planEntry.cliCommand, 'actual CLI command does not match capability plan');
      const matchingHost = hostInvocations.filter(host => host.operation_id === value.operation.id || host.request_id === value.operation.requestId);
      assert.equal(matchingHost.length, 1, 'unique Host operation/request required');
      const host = matchingHost[0];
      assert.equal(host.operation_id, value.operation.id, 'Host operation mismatch'); assert.equal(host.request_id, value.operation.requestId, 'Host request mismatch');
      for (const [key, column] of [['runId', 'run_id'], ['taskId', 'task_id'], ['projectId', 'project_id']]) assert.equal(host[column], expected[key], 'Host ' + key + ' mismatch');
      assert.equal(host.app_id, value.source.appId); assert.equal(host.package_hash, value.source.packageHash); assert.equal(host.tool_name, value.capabilityId);
      assert.equal(host.state, 'succeeded'); assert.equal(host.attempt_count, 1); assert.equal(host.effect_state, value.operation.effectState);
      const hostStarted = Date.parse(host.started_at), hostEnded = Date.parse(host.ended_at);
      assert(Number.isFinite(hostStarted) && Number.isFinite(hostEnded) && hostStarted <= hostEnded && hostStarted >= payload.started_at_ms && hostEnded <= payload.completed_at_ms, 'Host timing outside actual typed execution');
      const originalMatches = (journal.receipts ?? []).filter(receipt => receipt.value?.operation?.id === value.operation.id && receipt.value?.operation?.requestId === value.operation.requestId);
      assert(originalMatches.length <= 1, 'ambiguous original parser receipts');
      if (originalMatches.length) {
        assert.deepEqual(originalMatches[0].value, value, 'original parser JSON conflicts with typed JSON');
        if (originalMatches[0].childExitCodeObserved !== null && originalMatches[0].childExitCodeObserved !== undefined) assert.equal(originalMatches[0].childExitCodeObserved, item.exit_code, 'existing numeric exit conflicts');
      }
      const proof = {
        schema: 'native-typed-command-primary-proof-v1', source: copy(journal.source), typedCommandLine: line,
        nativeSessionId: expected.nativeSessionId, turnId: payload.turn_id, cwd: cwdPath(expected.cwd),
        typedCommandId: item.id, nativeProcessHandle: item.process_id, command: command.command, shellArgv: command.shellArgv,
        actualStatus: item.status, childExitCodeObserved: item.exit_code,
        operationId: value.operation.id, requestId: value.operation.requestId, capabilityId: value.capabilityId,
        runId: expected.runId, taskId: expected.taskId, projectId: expected.projectId,
        appId: value.source.appId, packageHash: value.source.packageHash, planHash: plan.planHash,
        typedRowSHA256: sha(JSON.stringify(row)), fullOutputBytes: Buffer.byteLength(item.aggregated_output), fullOutputSHA256: sha(item.aggregated_output),
        outputJSONSHA256: sha(JSON.stringify(value)), hostRowSHA256: sha(JSON.stringify(host)), planEntrySHA256: sha(JSON.stringify(planEntry)),
        startedAtMs: payload.started_at_ms, completedAtMs: payload.completed_at_ms,
        originalParserReceiptPresent: originalMatches.length === 1,
        originalParserChildExitCodeObserved: originalMatches[0]?.childExitCodeObserved ?? null,
        outerCarrierDecoded: false, modelCodeEvaluated: false,
        hashConvention: 'row/object SHA256(JSON.stringify(parsed original)); fullOutputSHA256 binds unmodified aggregated_output; source SHA binds exact original prefix bytes'
      };
      proofs.push(proof);
      receipts.push({
        provenance: 'native-typed-command-primary', source: journal.source.path, line, at: row.timestamp,
        callId: 'native-command:' + item.id, turnId: payload.turn_id, command: command.command,
        value: copy(value), childExitCodeObserved: item.exit_code, exitCode: item.exit_code, childExitUnknown: false,
        exitEvidence: 'actual-item_completed.CommandExecution-numeric-exit', typedCommandCompleted: true,
        originalParserReceipt: originalMatches.length ? copy(originalMatches[0]) : null,
        typedCommandExitProof: proof
      });
    } catch (error) { reject(line, error.message.split('\n')[0], {operationId: value.operation?.id ?? null, requestId: value.operation?.requestId ?? null}); }
  }
  return result();

  function result() {
    // Keep complete outer carrier rows privately without interpreting JavaScript.
    const outerRecords = rows.flatMap((row, index) => row.type === 'response_item' && ['function_call', 'custom_tool_call', 'function_call_output', 'custom_tool_call_output'].includes(row.payload?.type) ? [{source: journal.source.path, line: index + 1, row: copy(row)}] : []);
    return {schema: 'native-typed-command-primary-collection-v1', source: copy(journal.source), receipts, proofs, failures, diagnostics,
      originalParserReceipts: copy(journal.receipts ?? []), originalParserDiagnostics, originalParserUnmodified: true,
      outerRecords, outerRecordsPrivacy: 'private-only; whole original call/output rows may contain test data; do not log or archive without a safe projection',
      modelCodeEvaluated: false, producerDisposition: 'record-all-first; unknown outer carriers are diagnostic; business/safety judgement remains with original judges and coordinator'};
  }
}

export async function collectTypedPrimaryReceipts(options) {
  const {journal} = options, path = journal.source.path;
  assert(path.startsWith('/private/tmp/willyou-m12-') && path.includes('/sessions/') && path.endsWith('.jsonl'), 'only this test-owned Native journal permitted');
  assert.equal(await realpath(path), path, 'journal symlink/path alias not permitted');
  assert((await lstat(path)).isFile(), 'actual journal must be a regular file');
  assert(Number.isInteger(journal.source.bytes) && journal.source.bytes > 0 && journal.source.bytes <= 32 * 1024 * 1024);
  assert(/^[a-f0-9]{64}$/.test(journal.source.sha256));
  const data = await readFile(path);
  assert(data.length >= journal.source.bytes, 'captured source prefix truncated');
  const prefix = data.subarray(0, journal.source.bytes);
  assert.equal(sha(prefix), journal.source.sha256, 'captured exact Native source prefix changed');
  const lines = prefix.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const rows = lines.map(text => { assert(text.length > 0, 'hidden blank journal row'); return JSON.parse(text); });
  return deriveTypedPrimaryReceipts({...options, rows});
}
