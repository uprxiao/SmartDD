import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const prompt = 'M14_A20_ORDINARY_TARGET_SELECTION';
const parentDone = 'A20_PARENT_VALIDATED_ONE_RECEIPT';
export const childDone = 'A20_ONE_ORDINARY_CHILD_FINISHED';
export const firstPrompt = prompt;

const listTool = 'wy_targets';
const delegateTool = 'wy_delegate';
const staleKey = 'a20-original-stale-choice';
const acceptedKey = 'a20-refreshed-target-choice';
const childTitle = 'A20 one accepted ordinary child';
export { childTitle };

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
function namedTool(tools, expected) {
  const matched = tools.filter(tool => typeof tool.name === 'string' && tool.name.endsWith('__' + expected));
  assert.equal(matched.length, 1, 'exact actual native tool ' + expected);
  return matched[0];
}
export function toolReceipt(messages, toolUseId) {
  const matches = messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(block => block?.type === 'tool_result' && block.tool_use_id === toolUseId);
  assert.equal(matches.length, 1, 'exact one native receipt for ' + toolUseId);
  const [result] = matches;
  const pieces = typeof result.content === 'string' ? [result.content]
    : Array.isArray(result.content) ? result.content.filter(block => block?.type === 'text').map(block => block.text) : [];
  assert(pieces.every(text => typeof text === 'string'), 'native tool response must have text');
  const text = pieces.join('\n');
  let value;
  try { value = JSON.parse(text); } catch { /* A bridge error can be plain text. */ }
  return { toolUseId, isError: result.is_error === true, text, value };
}
function exactTarget(receipt, targetId, expectedName) {
  assert.equal(receipt.isError, false);
  const targets = receipt.value?.targets;
  assert(Array.isArray(targets), 'wy_targets actual response must include targets');
  const matches = targets.filter(target => target.profileId === targetId);
  assert.equal(matches.length, 1);
  const [target] = matches;
  assert.equal(target.name, expectedName);
  assert.equal(target.available, true);
  assert.match(target.revision, /^[0-9a-f]{64}$/);
  return target;
}
function persistentReceipt(response) {
  assert.equal(response.isError, false);
  assert.equal(response.value?.state, 'queued');
  assert.equal(response.value?.workspaceMode, 'shared');
  assert(response.value?.asynchronous);
  assert.match(response.value?.delegationId, /^[0-9a-f-]{36}$/);
  assert.match(response.value?.childTaskId, /^[0-9a-f-]{36}$/);
  return response.value;
}

export function createNativeDelegationFlow({ targetId, oldName, newName, childModel }) {
  const gates = { renamed: gate(), rejectionSeen: gate(), duplicateSeen: gate() };
  const observed = {};
  const calls = [];
  let stage = 'start';
  let handling = false;
  const intent = { title: childTitle, instructions: 'Return one fixed synthetic sentence as text, without calling tools.',
    access: 'write', workspaceMode: 'shared', model: childModel };

  function issue(tools, name, args, next) {
    const tool = namedTool(tools, name);
    if (name === delegateTool) {
      assert.equal(tool.input_schema?.properties?.profileRevision?.type, 'string',
        'package must announce the repaired profileRevision argument');
    }
    const id = 'toolu_' + randomUUID();
    calls.push({ id, tool: name, args: structuredClone(args) });
    stage = next;
    return { tool, args, id };
  }

  async function next({ tools, messages }) {
    assert.equal(handling, false, 'ordinary scenario expects a serial sequence of native calls');
    handling = true;
    try {
      if (stage === 'done') return { answer: parentDone };
      if (stage === 'start') {
        assert(JSON.stringify(messages).includes(prompt), 'first text must come through the actual composer');
        return issue(tools, listTool, {}, 'first-directory');
      }
      const reply = toolReceipt(messages, calls.at(-1).id);
      if (stage === 'first-directory') {
        observed.original = { toolUseId: reply.toolUseId, target: exactTarget(reply, targetId, oldName) };
        await gates.renamed.promise;
        return issue(tools, delegateTool, { ...intent, requestKey: staleKey, profileId: observed.original.target.profileId,
          profileRevision: observed.original.target.revision }, 'stale-receipt');
      }
      if (stage === 'stale-receipt') {
        assert.equal(reply.isError, true);
        assert.match(reply.text, /委派目标配置或模型已经变化.*重新查询/);
        assert(!reply.value?.childTaskId, 'a rejected stale key must not get a successful child receipt');
        observed.staleRejected = { toolUseId: reply.toolUseId, code: reply.value?.error?.code, text: reply.text.slice(0, 300) };
        await gates.rejectionSeen.promise;
        return issue(tools, listTool, {}, 'updated-directory');
      }
      if (stage === 'updated-directory') {
        const target = exactTarget(reply, targetId, newName);
        assert.notEqual(target.revision, observed.original.target.revision);
        observed.refreshed = { toolUseId: reply.toolUseId, target };
        return issue(tools, delegateTool, { ...intent, requestKey: acceptedKey, profileId: target.profileId,
          profileRevision: target.revision }, 'accepted-receipt');
      }
      if (stage === 'accepted-receipt') {
        observed.accepted = { toolUseId: reply.toolUseId, value: persistentReceipt(reply) };
        // Deliberately replay the already accepted key with the stale revision.
        // The failed first key never had a receipt.
        return issue(tools, delegateTool, { ...intent, requestKey: acceptedKey,
          profileId: observed.original.target.profileId, profileRevision: observed.original.target.revision }, 'duplicate-receipt');
      }
      assert.equal(stage, 'duplicate-receipt');
      const value = persistentReceipt(reply);
      observed.duplicated = { toolUseId: reply.toolUseId, value };
      assert.deepEqual(value, observed.accepted.value, 'a known accepted key must win over the stale revision and return its original receipt');
      await gates.duplicateSeen.promise;
      stage = 'done';
      return { answer: parentDone };
    } finally {
      handling = false;
    }
  }
  return { calls, observed, next, release: name => gates[name].release(),
    finishCleanup: () => { Object.values(gates).forEach(item => item.release()); } };
}
