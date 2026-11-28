// Pure parsing for the actual native Codex unified-exec response envelope.
// The model fixture must issue the browser command once. A running response
// only permits empty-input polling of that exact native session.
import assert from 'node:assert/strict';

const MAX_PASSIVE_POLLS = 6;
const positiveSession = value => Number.isSafeInteger(value) && value > 0;
const numericProperty = property => ['integer', 'number'].includes(property?.type);

export function createNativeReceipt() {
  return {poll: 0, session: null, firstPending: false, actualHistory: [], chunks: [], terminal: false};
}

export function parseNativeEnvelope(raw) {
  assert.equal(typeof raw, 'string', 'native tool output must be the actual unified-exec text envelope');
  const delimiter = /\r?\nOutput:\r?\n/.exec(raw);
  assert(delimiter, 'missing actual native Output delimiter');
  const lines = raw.slice(0, delimiter.index).split(/\r?\n/);
  assert.equal(lines.length, 4, 'unrecognized native envelope header');
  assert(/^Chunk ID: [a-f0-9]+$/i.test(lines[0]), 'missing actual native chunk ID');
  assert(/^Wall time: \d+(?:\.\d+)? seconds$/.test(lines[1]), 'missing actual native wall time');
  assert(/^Original token count: \d+$/.test(lines[3]), 'missing actual native token count');
  const pending = /^Process running with session ID (\d+)$/.exec(lines[2]);
  const complete = /^Process exited with code (-?\d+)$/.exec(lines[2]);
  assert(pending || complete, 'native result has neither running-session nor terminal-exit status');
  const payload = raw.slice(delimiter.index + delimiter[0].length);
  if (pending) {
    const session = Number(pending[1]);
    assert(positiveSession(session), 'invalid native session identity');
    return {kind: 'running', session, payload};
  }
  const code = Number(complete[1]);
  assert(Number.isSafeInteger(code), 'invalid native exit status');
  return {kind: 'exited', code, payload};
}

export function passivePollInput(tool, session) {
  assert(positiveSession(session), 'invalid native session identity');
  assert(tool?.type === 'function' && tool.name === 'write_stdin', 'actual native write_stdin tool absent');
  const schema = tool.parameters, properties = schema?.properties ?? {};
  assert.equal(schema?.type, 'object', 'unexpected actual write_stdin schema');
  assert(numericProperty(properties.session_id), 'actual write_stdin session_id contract unavailable');
  assert.equal(properties.chars?.type, 'string', 'actual write_stdin empty-input contract unavailable');
  const input = {session_id: session, chars: ''};
  if (properties.yield_time_ms) {
    assert(numericProperty(properties.yield_time_ms));
    input.yield_time_ms = 5000;
  }
  if (properties.max_output_tokens) {
    assert(numericProperty(properties.max_output_tokens));
    input.max_output_tokens = 3000;
  }
  assert((schema.required ?? []).every(key => Object.hasOwn(input, key)), 'unknown required actual write_stdin parameter');
  return input;
}

export function acceptNativeEnvelope(state, raw) {
  assert(!state.terminal, 'unexpected second native terminal receipt');
  const frame = parseNativeEnvelope(raw);
  state.actualHistory.push(raw);
  state.chunks.push(frame.payload);
  if (frame.kind === 'running') {
    if (state.session === null) {
      state.session = frame.session;
      state.firstPending = state.actualHistory.length === 1;
    } else {
      assert.equal(frame.session, state.session, 'native polling session identity changed');
    }
    assert(state.poll < MAX_PASSIVE_POLLS, 'actual native passive poll limit reached');
    state.poll++;
    return {kind: 'pending', session: state.session, poll: state.poll};
  }
  assert.equal(frame.code, 0, 'actual native shell command did not exit successfully');
  state.terminal = true;
  return {
    kind: 'terminal',
    output: state.chunks.join(''),
    nativeTerminal: {
      code: frame.code,
      poll: state.poll,
      session: state.session,
      firstPending: state.firstPending,
      actualHistory: [...state.actualHistory],
    },
  };
}

export function exactNativeOutput(history, callId) {
  const matches = (Array.isArray(history) ? history : []).filter(
    item => item.type === 'function_call_output' && item.call_id === callId,
  );
  assert.equal(matches.length, 1, 'missing or duplicate output for exact current native call');
  return matches[0].output;
}

export function readSnapshotReceipt(payload, page) {
  const results = [];
  for (const line of payload.split('\n')) {
    const start = line.indexOf('{');
    if (start < 0) continue;
    let value;
    try { value = JSON.parse(line.slice(start)); } catch { continue; }
    if (value?.schema === 'willyou-app-result-v2') results.push(value);
  }
  assert.equal(results.length, 1, 'exactly one actual CLI result required');
  const result = results[0];
  assert.equal(result.status, 'ok');
  assert.equal(result.data?.browserPageId, page.id);
  assert.equal(result.data?.url, page.url);
  assert(result.data?.snapshot?.includes('静态资源夹具'));
  assert.equal(result.source?.appId, 'browser');
  assert.equal(result.operation?.origin, 'cli');
  assert.equal(result.operation?.effectState, 'read-only');
  return result;
}
