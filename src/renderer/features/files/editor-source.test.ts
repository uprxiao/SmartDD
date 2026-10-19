import { EditorState } from '@codemirror/state';
import { history, undo } from '@codemirror/commands';
import { describe, expect, it } from 'vitest';
import { createSourceField } from './editor-source';
describe('raw transaction preview before downstream fields',()=>{
 it('previews actual UTF16 edits and preferred EOLs without applying state',()=>{
  const source=createSourceField('中文🙂\r\nSecond\rThird\n'),state=EditorState.create({doc:source.normalized,extensions:[source.extensions]});
  const tr=state.update({changes:{from:4,to:5,insert:'\nNew\n'}}),preview=source.preview(tr);
  expect(state.field(source.field).raw).toBe('中文🙂\r\nSecond\rThird\n');expect(preview.raw).toBe('中文🙂\r\nNew\r\nSecond\rThird\n');expect(tr.state.field(source.field).raw).toBe(preview.raw);
 });
 it('previews the exact mixed EOL restoration from an undo effect',()=>{
  const raw='One\r\nTwo\rThree\n',source=createSourceField(raw);let state=EditorState.create({doc:source.normalized,extensions:[source.extensions,history()]});
  state=state.update({changes:{from:0,to:state.doc.length,insert:'Changed\nLines'},userEvent:'input.type'}).state;
  expect(undo({state,dispatch:tr=>{const preview=source.preview(tr);expect(preview.raw).toBe(raw);state=tr.state;}})).toBe(true);expect(state.field(source.field).raw).toBe(raw);
 });
});
