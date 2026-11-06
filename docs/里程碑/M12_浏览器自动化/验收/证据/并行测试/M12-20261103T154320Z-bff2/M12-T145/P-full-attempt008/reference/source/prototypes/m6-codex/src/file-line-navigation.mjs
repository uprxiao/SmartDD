import{resolveLineTarget,STALE_LINE_PREVIEW}from'../../../src/renderer/features/files/line-target.ts';
/** P only: real textarea geometry over synthetic source; no native IO. */
export function prototypeLineNavigator(element,owns){
 const source=element.value,snapshot={start:element.selectionStart,end:element.selectionEnd,direction:element.selectionDirection,top:element.scrollTop,left:element.scrollLeft};let expected={...snapshot},closed=false;
 const initialLine=source.slice(0,snapshot.direction==='backward'?snapshot.start:snapshot.end).split('\n').length,lineCount=source.split('\n').length;
 const isCurrent=()=>!closed&&element.isConnected&&owns()&&element.value===source&&element.selectionStart===expected.start&&element.selectionEnd===expected.end&&element.selectionDirection===expected.direction;
 const preview=value=>{if(!isCurrent())return{valid:false,error:STALE_LINE_PREVIEW};const result=resolveLineTarget(value,lineCount);if(result.valid){const offset=source.split('\n').slice(0,result.line-1).join('\n').length+(result.line>1?1:0);element.setSelectionRange(offset,offset);element.scrollTop=Math.max(0,(result.line-3)*21);element.scrollLeft=0;expected={start:element.selectionStart,end:element.selectionEnd,direction:element.selectionDirection}}return result};
 return{initialLine,lineCount,isCurrent,preview,commit(value){const result=preview(value);if(result.valid){closed=true;element.focus({preventScroll:true})}return result},cancel(focus=true){const restore=isCurrent();closed=true;if(!restore)return false;element.setSelectionRange(snapshot.start,snapshot.end,snapshot.direction);element.scrollTop=snapshot.top;element.scrollLeft=snapshot.left;if(focus)element.focus({preventScroll:true});return true}};
}
