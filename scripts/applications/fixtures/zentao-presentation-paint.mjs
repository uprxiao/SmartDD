// Read-only observation shared by synthetic P and actual A presentation deltas.
export function zentaoPresentationPaint(){
 const d=document.querySelector('dialog'),grid=d?.querySelector('.m10-detail-props');
 if(!grid)throw Error('Visible detail grid required');
 const props=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor','borderRadius','padding','gap','gridTemplateColumns','whiteSpace','overflowWrap'];
 const style=e=>Object.fromEntries(props.map(k=>[k,getComputedStyle(e)[k]]));
 return{window:{width:innerWidth,height:innerHeight},theme:document.documentElement.dataset.theme??(document.documentElement.classList.contains('ydark')?'dark':'light'),grid:style(grid),fields:[...grid.querySelectorAll('[data-field]')].map(e=>({key:e.dataset.field,label:e.childNodes[0].textContent,text:e.querySelector('strong').textContent,cell:style(e),value:style(e.querySelector('strong')),contained:e.scrollWidth<=e.clientWidth+1})),alerts:[...d.querySelectorAll('[role=alert]')].map(e=>e.textContent),bodySections:d.querySelectorAll('pre').length,dialogHorizontalOverflow:d.scrollWidth>d.clientWidth+1,hasObjectString:d.textContent.includes('[object Object]')};
}
export const zentaoPresentationPaintExpression='('+zentaoPresentationPaint.toString()+')()';
