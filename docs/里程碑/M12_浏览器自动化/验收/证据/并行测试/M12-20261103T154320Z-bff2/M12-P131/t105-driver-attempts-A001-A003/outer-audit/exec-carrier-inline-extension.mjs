// A single additional finite AST form. Never eval/Function/execute model JavaScript.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import ts from '/private/tmp/willyou-m12-t105-App025-A-R-003/node_modules/typescript/lib/typescript.js';
import * as original from '/private/tmp/willyou-m12-t105-App025-A-R-003/exec-carrier.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');

function inlineOutput(input) {
  assert(typeof input === 'string' && Buffer.byteLength(input) <= 262144);
  const file = ts.createSourceFile('saved-inline-output.js', input, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(file.parseDiagnostics.length, 0, 'invalid saved JavaScript syntax');
  assert.equal(file.statements.length, 1, 'only one inline text statement is supported');
  const statement = file.statements[0];
  assert(ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression));
  const emit = statement.expression;
  assert(!emit.questionDotToken && !emit.typeArguments && ts.isIdentifier(emit.expression) && emit.expression.text === 'text' && emit.arguments.length === 1, 'exact text(arg) required');
  const output = emit.arguments[0];
  assert(ts.isPropertyAccessExpression(output) && !output.questionDotToken && output.name.text === 'output', 'exact .output property required');
  assert(ts.isParenthesizedExpression(output.expression) && ts.isAwaitExpression(output.expression.expression), 'exact parenthesized await required');
  const awaited = output.expression.expression.expression;
  assert(ts.isCallExpression(awaited) && !awaited.questionDotToken && !awaited.typeArguments && awaited.arguments.length === 1);
  assert(ts.isPropertyAccessExpression(awaited.expression) && !awaited.expression.questionDotToken && ts.isIdentifier(awaited.expression.expression) && awaited.expression.expression.text === 'tools' && awaited.expression.name.text === 'exec_command', 'only tools.exec_command is supported by the new form');
  assert(ts.isObjectLiteralExpression(awaited.arguments[0]), 'literal object required');
  // The original parser validates every literal/property. This is syntax normalization, not execution.
  const normalized = 'const r = await tools.exec_command(' + awaited.arguments[0].getText(file) + ');text(r.output);';
  const decoded = original.parseCustomExecInput({name: 'exec', input: normalized});
  assert.equal(decoded.commands.length, 1);
  assert.equal(decoded.commands[0].toolName, 'exec_command');
  return {normalized, decoded, inputSha256: sha(input)};
}
function variant(parameters) {
  try { return {decoded: original.parseCustomExecInput(parameters), extensionUsed: false}; }
  catch (originalError) {
    assert.equal(parameters.name, 'exec');
    const extension = inlineOutput(parameters.input);
    return {...extension, extensionUsed: true, originalParserRejected: true,
      decoded: {...extension.decoded, inputSha256: extension.inputSha256, mode: 'inline-output', sourceKind: 'custom-exec-finite-inline-output-extension', astContract: 'text((await tools.exec_command(LITERAL_OBJECT)).output);'}};
  }
}

export function parseCustomExecInput(parameters) { return variant(parameters).decoded; }
export function decodeToolRequest(payload) {
  if (payload.type !== 'custom_tool_call') return original.decodeToolRequest(payload);
  assert(typeof payload.call_id === 'string' && payload.call_id);
  return {...parseCustomExecInput(payload), callId: payload.call_id, name: payload.name, requestType: payload.type};
}
export function decodeToolPair(options) {
  if (options.requestRow.payload.type !== 'custom_tool_call') return original.decodeToolPair(options);
  const selected = variant(options.requestRow.payload);
  if (!selected.extensionUsed) return original.decodeToolPair(options);
  const normalizedRequest = {...options.requestRow, payload: {...options.requestRow.payload, input: selected.normalized}};
  const pair = original.decodeToolPair({...options, requestRow: normalizedRequest});
  pair.request = {...selected.decoded, callId: options.requestRow.payload.call_id, name: options.requestRow.payload.name, requestType: options.requestRow.payload.type};
  for (const invocation of pair.invocations) {
    invocation.output.carrierKind = 'custom-inline-forwarded-output';
    invocation.output.exitEvidence = 'Actual inline result.output omits numeric child exit; require independent typed exit proof';
    assert.equal(invocation.output.childExitCodeObserved, null);
  }
  pair.extension = {schema: 'single-inline-output-ast-extension-v1', originalParserRejected: true, originalSourceUnmodified: true,
    requestInputSHA256: selected.inputSha256, normalizedSyntaxSHA256: sha(selected.normalized), modelCodeEvaluated: false,
    boundary: 'Only syntax/output attribution; no numeric exit, business success or R acceptance inferred'};
  return pair;
}
