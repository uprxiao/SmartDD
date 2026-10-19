import { ChangeSet, Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getOriginalDoc, originalDocChangeEffect, unifiedMergeView } from '@codemirror/merge';
import { fileInlineDiffPolicy } from '@shared/file-inline-diff.mjs';
import { textOffsetMap } from '@shared/file-text';
import type { createSourceField } from './editor-source';

const originalSourceChanged=StateEffect.define<string>();
/** This is display-only original source, never the local source field or a
 * persisted save baseline. Decision controls remain in the workspace host. */
export const fileConflictOriginal=StateField.define<string>({create:()=>'',update:(raw,tr)=>{for(const effect of tr.effects)if(effect.is(originalSourceChanged))raw=effect.value;return raw;}});
export function fileConflictDiffGuard(slot:Compartment,source:ReturnType<typeof createSourceField>){
 return EditorState.transactionExtender.of(transaction=>{
  const original=transaction.startState.field(fileConflictOriginal,false);
  if(!transaction.docChanged||original===undefined)return null;
  return fileInlineDiffPolicy(original,source.preview(transaction).raw).state==='enabled'?null:{effects:slot.reconfigure([])};
 });
}
const theme=EditorView.theme({
 '.cm-changedLine':{backgroundColor:'color-mix(in srgb, #40ad68 10%, transparent)'},
 '.cm-changedText':{backgroundColor:'color-mix(in srgb, #40ad68 24%, transparent)'},
 '.cm-deletedChunk':{backgroundColor:'color-mix(in srgb, #e46666 10%, transparent)',color:'var(--fw-code-text)',padding:'0 12px',whiteSpace:'pre'},
 '.cm-deletedText':{backgroundColor:'color-mix(in srgb, #e46666 24%, transparent)'},
 '.cm-deletedLine del, del.cm-deletedText':{textDecoration:'none'},
});
/** Install/remove only diff state. Source, history, selection, file revision
 * and persistence remain owned by the original editor/buffer. */
export function syncFileConflictDiff(view:EditorView,slot:Compartment,original:string|null,local:string){
 const policy=fileInlineDiffPolicy(original,local),active=view.state.field(fileConflictOriginal,false);
 if(policy.state!=='enabled'){
  if(active!==undefined)view.dispatch({effects:slot.reconfigure([])});
  return policy;
 }
 const raw=original!,normalized=textOffsetMap(raw).normalized;
 if(active===undefined){
  view.dispatch({effects:slot.reconfigure([fileConflictOriginal.init(()=>raw),unifiedMergeView({original:normalized,mergeControls:false,allowInlineDiffs:true,highlightChanges:true,syntaxHighlightDeletions:false,gutter:true,diffConfig:{scanLimit:500,timeout:50}}),theme])});
 }else if(active!==raw){
  const previous=getOriginalDoc(view.state),changes=ChangeSet.of({from:0,to:previous.length,insert:normalized},previous.length);
  view.dispatch({effects:[originalDocChangeEffect(view.state,changes),originalSourceChanged.of(raw)]});
 }
 return policy;
}
