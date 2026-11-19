import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const model = 'deepseek-flash';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const factNames = { A: 'alfa', B: 'bravo', C: 'charlie', D: 'delta', E: 'echo' };
export const supportedPaths = {
  '/v1/responses': { protocol: 'responses', upstream: 'https://api.deepseek.com/responses' },
  '/v1/messages': { protocol: 'anthropic', upstream: 'https://api.deepseek.com/anthropic/v1/messages' },
};
const methods = { codex: 'responses', claude: 'anthropic' };
const opening = '[WillYou 历史交接 ';
const closing = '[/历史交接]';
const transferIdShape = '[a-f0-9-]{36}';

export function makeTurns(ref, values) {
  assert.match(ref, /^[a-f0-9]{12}$/);
  assert.deepEqual(Object.keys(values), Object.keys(factNames));
  for (const value of Object.values(values)) assert.match(value, /^A15FACT_[a-f0-9]{24}$/);
  assert.equal(new Set(Object.values(values)).size, Object.keys(factNames).length);
  const phases = [
    { name: 'a1', actor: 'codex', learn: 'A', query: ['A'], transfer: null },
    { name: 'b1', actor: 'claude', learn: 'B', query: ['A','B'], transfer: 'full', newFact: 'A' },
    { name: 'a2', actor: 'codex', learn: 'C', query: ['A','B','C'], transfer: 'incremental', newFact: 'B' },
    { name: 'b2', actor: 'claude', learn: 'D', query: ['A','B','C','D'], transfer: 'incremental', newFact: 'C' },
    { name: 'same-binding-control', actor: 'claude', query: ['E'], unknown: 'E', transfer: null },
    { name: 'withheld-increment-control', actor: 'codex', query: ['A','B','D'], unknown: 'D', transfer: 'incremental', newFact: 'D', withhold: true },
  ];
  return phases.map(phase => {
    const marker = 'M14-A15:' + ref + ':' + phase.name;
    const { learn, query, unknown } = phase;
    const instruction = [
      marker,
      learn && ('Remember this fixture fact: ' + factNames[learn] + ' is ' + values[learn] + '.'),
      'Using the historical context and your own conversation, report the values for these named fixture facts: ' + query.map(key=>factNames[key]).join(', ') + '.',
      'When a value is absent, answer UNKNOWN; never guess. Return one plain line in exactly this format: ' +
        query.map(key=>key + '=<value>').join(' ') + '. Do not call any tools.',
    ].filter(Boolean).join('\n');
    return { ...phase, marker, instruction, protocol: methods[phase.actor],
      answer: query.map(key=>key + '=' + (key === unknown ? 'UNKNOWN' : values[key])).join(' ') };
  });
}

function visitStrings(value, visit, parent, key) {
  if (typeof value === 'string') visit(value, parent, key);
  else if (value && typeof value === 'object') {
    for (const [childKey, item] of Object.entries(value)) visitStrings(item, visit, value, childKey);
  }
}

function matchingEnvelopes(body) {
  const matches = [];
  const format = new RegExp('^\\[WillYou 历史交接 (' + transferIdShape + ')；', 'u');
  visitStrings(body, (text, parent, key) => {
    let offset = 0;
    while ((offset = text.indexOf(opening, offset)) >= 0) {
      const end = text.indexOf(closing, offset);
      assert(end > offset, 'Incomplete history envelope');
      const closingEnd = end + closing.length;
      const length = closingEnd + Number(text[closingEnd] === '\n') - offset;
      const envelope = text.slice(offset, closingEnd);
      const identity = format.exec(envelope);
      assert(identity, 'Malformed history envelope');
      const bodyLines = envelope.split('\n').slice(1, -1).filter(line=>line.startsWith('{'));
      const entries = bodyLines.map(line=>JSON.parse(line));
      assert(entries.every(entry=>typeof entry.itemId === 'string' && Number.isSafeInteger(entry.revision) && entry.sourceKind === 'history'),
        'Non-history row in history envelope');
      matches.push({ transferId:identity[1], envelope, entries, offset, length, parent, key, canonicalHash:sha(text.slice(offset,offset+length)) });
      offset += length;
    }
  });
  return matches;
}

function latestFixtureMarker(body, protocol, phases) {
  const input = protocol === 'responses' ? body.input : body.messages;
  assert(Array.isArray(input), 'Unexpected native message container');
  let found;
  for (const message of input) {
    if (message?.role !== 'user') continue;
    visitStrings(message.content, text => {
      const current = phases.find(phase=>text.includes(phase.instruction));
      if (current) found = current;
    });
  }
  return found;
}

function rejectNonTextPayload(body) {
  visitStrings(body, (text, parent, key) => {
    if (key === 'type') assert(!['image','input_image','input_file','document','tool_result','function_call_output','computer_call_output'].includes(text),
      'Only text-only, tool-free fixture input may leave the loopback adapter');
  });
}

export function prepareRequest({ body, protocol, active, phases, values, previousIds }) {
  assert(active, 'No active real composer action for the isolated request');
  assert.equal(body.model, model, 'Unexpected native model');
  rejectNonTextPayload(body);
  assert.equal(active.protocol, protocol, 'Wrong transport for the active fixture stage');
  assert.equal(latestFixtureMarker(body, protocol, phases)?.name, active.name, 'Latest native user request did not contain the exact active fixture prompt');
  const digestBefore = sha(JSON.stringify(body));
  const outbound = structuredClone(body);
  const envelopes = matchingEnvelopes(outbound);
  const newEnvelopes = envelopes.filter(entry=>!previousIds.has(entry.transferId));
  assert.equal(newEnvelopes.length, active.transfer ? 1 : 0, 'Wrong number of new history envelopes');
  const current = newEnvelopes[0];
  const introduced = current?.entries.some(entry=>JSON.stringify(entry.content).includes(values[active.newFact]));
  if (active.transfer) assert(introduced, 'Expected new source fact absent from the current handoff');
  if (active.withhold) {
    const text = current.parent[current.key];
    current.parent[current.key] = text.slice(0,current.offset) + text.slice(current.offset + current.length);
    const after = JSON.stringify(outbound);
    assert(!after.includes(values[active.unknown]), 'Withheld fact appeared outside the exact removed handoff');
    assert(['A','B'].every(key=>after.includes(values[key])), 'Known facts disappeared from the retained native context');
    assert(after.includes(active.instruction.replaceAll('\n', '\\n')), 'The current prompt was affected by withholding history');
  }
  if (active.unknown && !active.withhold)
    assert(!JSON.stringify(outbound).includes(values[active.unknown]), 'Unknown control fact escaped into the request');
  return {
    outbound,
    audit: { stage:active.name, marker:active.marker, protocol, model:body.model,
      inputSha256:digestBefore, forwardedSha256:sha(JSON.stringify(outbound)),
      inputBytes:Buffer.byteLength(JSON.stringify(body)), forwardedBytes:Buffer.byteLength(JSON.stringify(outbound)),
      nativeHistoryIds:envelopes.map(e=>e.transferId),
      newlyInjectedId: current?.transferId ?? null,
      newHistoryDigest: current ? sha(current.envelope) : null,
      newHistoryCanonicalHash: current?.canonicalHash ?? null,
      sourceEntries: current?.entries.map(({itemId,revision,type})=>({itemId,revision,type})) ?? [],
      introducedNewFact: Boolean(introduced),
      withheldId: active.withhold ? current.transferId : null,
      forwardedFactNames: Object.keys(factNames).filter(key=>JSON.stringify(outbound).includes(values[key])),
    },
  };
}

