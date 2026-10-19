import {StateEffect,StateField} from '@codemirror/state';
import {Decoration,EditorView} from '@codemirror/view';
import {findFileText,type FileFindResult} from './text-find';

interface FileFindState extends FileFindResult { query:string; current:number }
const empty:FileFindState={query:'',current:0,matches:[],limited:false};
export const fileFindQuery=StateEffect.define<string>();
export const fileFindCurrent=StateEffect.define<number>();
/** Per-EditorState only. Query/navigation never changes source or history. */
export const fileFindState=StateField.define<FileFindState>({
 create:()=>empty,
 update(value,transaction){
  let query=value.query,current=value.current;
  for(const effect of transaction.effects){if(effect.is(fileFindQuery)){query=effect.value;if(query!==value.query)current=0}if(effect.is(fileFindCurrent))current=effect.value}
  if(!query)return empty;
  const result=transaction.docChanged||query!==value.query?findFileText(transaction.newDoc.toString(),query):value;
  current=Math.max(0,Math.min(Number.isSafeInteger(current)?current:0,result.matches.length-1));
  return query===value.query&&result===value&&current===value.current?value:{...result,query,current};
 },
 provide:field=>EditorView.decorations.from(field,value=>Decoration.set(value.matches.map((match,index)=>Decoration.mark({class:'fw-find-match'+(index===value.current?' fw-find-current':''),attributes:{'data-find-from':String(match.from),'data-find-to':String(match.to)}}).range(match.from,match.to)),true)),
});
