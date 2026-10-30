import { StateEffect, StateField, type Extension, type Transaction } from '@codemirror/state';
import { invertedEffects } from '@codemirror/commands';
import { eolRuns, preferredEol, restoreEols, textOffsetMap, type EolRun } from '@shared/file-text';

const restoreEndings = StateEffect.define<EolRun[]>();

/** A distinct field per document prevents one editor's seed/history from being
 * read by another. Markdown and source views share this authoritative state. */
export function createSourceField(initialRaw: string) {
  type Source = { raw: string; map: ReturnType<typeof textOffsetMap>; eol: ReturnType<typeof preferredEol> };
  const update = (value: Source, transaction: Transaction): Source => {
    if (!transaction.docChanged) return value;
    let raw = value.raw;
    const patches: { from: number; to: number; insert: string }[] = [];
    transaction.changes.iterChanges((from, to, _newFrom, _newTo, insert) => patches.push({ from: value.map.cmToRaw(from), to: value.map.cmToRaw(to), insert: insert.toString().replace(/\n/g, value.eol) }));
    for (const patch of patches.reverse()) raw = raw.slice(0, patch.from) + patch.insert + raw.slice(patch.to);
    for (const effect of transaction.effects) if (effect.is(restoreEndings)) raw = restoreEols(raw, effect.value);
    const map = textOffsetMap(raw);
    if (map.normalized !== transaction.newDoc.toString()) throw new Error('文件原始换行与编辑器状态不一致');
    return { raw, map, eol: value.eol };
  };
  const field = StateField.define({
    create: () => ({ raw: initialRaw, map: textOffsetMap(initialRaw), eol: preferredEol(initialRaw) }),
    update,
  });
  const extensions: Extension = [field, invertedEffects.of((transaction) => transaction.docChanged ? [restoreEndings.of(eolRuns(transaction.startState.field(field).raw))] : [])];
  // A transaction extender can inspect the exact future raw EOLs without
  // forcing tr.state (which would already run downstream diff fields).
  return { field, extensions, normalized: textOffsetMap(initialRaw).normalized, preview: (transaction: Transaction) => update(transaction.startState.field(field), transaction) };
}
