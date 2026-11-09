import assert from'node:assert/strict';

// Only the original aria-hidden, pointer-events:none Notebook Run decoration.
// This does not replace or relax ordinary makeHostUI.click.
export const decorativeRunExpression=expectedPath=>`(()=>{const all=[...document.querySelectorAll('.fa-notebook .fw-notebook-run')],e=all.length===1?all[0]:null,cell=e?.closest('.fa-notebook-cell'),summary=e?.closest('summary'),execution=e?.parentElement,r=e?.getBoundingClientRect(),s=e?getComputedStyle(e):null,p=e?.closest('.fa-notebook-scroll')?.getBoundingClientRect(),tab=document.querySelector('.fw-tab [role=tab][aria-selected=true]');let visible=!!r&&r.width>0&&r.height>0,opacity=1;for(let n=e;n;n=n.parentElement){const c=getComputedStyle(n);visible=visible&&c.display!=='none'&&c.visibility!=='hidden';opacity*=Number(c.opacity);}const x=r?r.x+r.width/2:null,y=r?r.y+r.height/2:null,hit=r?document.elementFromPoint(x,y):null,sameParents=!!e&&!!cell&&summary?.parentElement===cell&&execution?.parentElement===summary&&execution.classList.contains('fa-notebook-execution'),relation=hit&&sameParents?(hit===execution?'execution':hit===summary?'summary':'other'):'other';return{at:new Date().toISOString(),count:all.length,tag:e?.tagName??null,title:e?.title??null,ariaHidden:e?.getAttribute('aria-hidden')??null,tabIndex:e?.tabIndex??null,buttonAncestor:!!e?.closest('button'),pointerEvents:s?.pointerEvents??null,effectiveOpacity:opacity,boxVisible:visible,focused:document.hasFocus(),visibility:document.visibilityState,expectedFileMatches:tab?.title===${JSON.stringify(expectedPath)},sameParents,cellIndex:cell?.getAttribute('data-cell-index')??null,cellHovered:!!cell?.matches(':hover'),summaryOpen:cell?.open??null,inViewport:!!r&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&(!p||(r.top>=p.top&&r.bottom<=p.bottom)),rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null,x,y,hit:{tag:hit?.tagName??null,className:String(hit?.className??''),relation,cellIndex:hit?.closest('.fa-notebook-cell')?.getAttribute('data-cell-index')??null}}})()`;

export function decorativeRunRejectReasons(v,{afterHover=false}={}){
 const reasons=[];
 if(v?.count!==1)reasons.push('not-unique');
 if(v?.tag!=='SPAN'||v.title!=='Running is disabled in read-only preview'||v.ariaHidden!=='true'||v.tabIndex!==-1||v.buttonAncestor)reasons.push('not-exact-readonly-decoration');
 if(v?.pointerEvents!=='none')reasons.push('not-pointer-events-none');
 if(!v?.boxVisible||!v?.inViewport||!v?.rect||v.rect.width<=0||v.rect.height<=0)reasons.push('not-visible-in-viewport');
 if(!v?.focused||v.visibility!=='visible')reasons.push('not-focused');
 if(!v?.expectedFileMatches||v.cellIndex!=='0')reasons.push('wrong-file-or-cell');
 if(!v?.sameParents||!['execution','summary'].includes(v?.hit?.relation)||v.hit.cellIndex!==v.cellIndex)reasons.push('external-or-unqualified-hit');
 if(afterHover&&(!v?.cellHovered||!Number.isFinite(v.effectiveOpacity)||v.effectiveOpacity<0.99))reasons.push('not-actually-visible-after-hover');
 return reasons;
}

export async function inputDecorativeRun({app,mode,poll,persist,expectedPath}){
 const rows=[],observe=async step=>{const value=await app.evaluate(decorativeRunExpression(expectedPath)),row={kind:'decorative-run-observation',step,value,rejectReasons:decorativeRunRejectReasons(value,{afterHover:step!=='before-hover'})};rows.push(row);mode.actions.push(row);await persist();return value;};
 await app.checkInputFocus('F21.decorativeRun.beforeHover');const before=await observe('before-hover');assert.deepEqual(decorativeRunRejectReasons(before),[],'Only exact own-cell decoration may receive hover');
 await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:before.x,y:before.y});
 let key,since;const actual=await poll(async()=>{await app.checkInputFocus('F21.decorativeRun.hoverWait');const v=await observe('after-hover');if(decorativeRunRejectReasons(v,{afterHover:true}).length){key=null;since=null;return null;}const k=JSON.stringify(v.rect);if(k===key)since??=Date.now();else since=null;key=k;return since&&Date.now()-since>=120?v:null;},15000);
 await app.checkInputFocus('F21.decorativeRun.beforeMouse');const final=await observe('before-input');assert.deepEqual(decorativeRunRejectReasons(final,{afterHover:true}),[]);assert.deepEqual(final.rect,actual.rect);
 for(const type of['mousePressed','mouseReleased'])await app.cdp('Input.dispatchMouseEvent',{type,x:final.x,y:final.y,button:'left',clickCount:1});
 for(const[key,code]of[['Enter','Enter'],[' ','Space']]){await app.checkInputFocus('F21.decorativeRun.beforeKey');for(const type of['keyDown','keyUp'])await app.cdp('Input.dispatchKeyEvent',{type,key,code});}
 const after=await observe('after-input');return{before,actual:final,after,observations:rows,geometryStableMsAtLeast:120,mouseInputSent:true,keysSent:['Enter','Space'],guarded:true,scope:'Exact noninteractive decoration only; own-cell execution/summary hit accepted; no DOM.click or ordinaryclick relaxation'};
}
