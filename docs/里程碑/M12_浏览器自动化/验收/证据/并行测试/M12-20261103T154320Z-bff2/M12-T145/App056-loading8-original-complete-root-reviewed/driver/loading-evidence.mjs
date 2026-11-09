import assert from 'node:assert/strict';
// Pure read-only descriptions. A zero-height progress anchor is intentional;
// its ::before paints a two-pixel strip and must not be filtered as invisible.
export const loadingExpression=`(()=>{const rect=e=>{const r=e?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}:null},stop=document.querySelector('[aria-label="停止加载"]'),svg=stop?.querySelector('svg'),e=document.querySelector('.bw-progress'),s=e?getComputedStyle(e):null,p=e?getComputedStyle(e,'::before'):null,r=rect(e),height=p?parseFloat(p.height):0,top=p?parseFloat(p.top):0,paint=r?{x:r.x,y:r.y+top,width:r.width,height,right:r.right,bottom:r.y+top+height}:null,clips=e?[...function*(n){for(let a=n.parentElement;a;a=a.parentElement)yield a}(e)].map(a=>({rect:rect(a),overflowX:getComputedStyle(a).overflowX,overflowY:getComputedStyle(a).overflowY})):[],phaseX=p?parseFloat(p.backgroundPositionX):null,center=paint?{x:paint.x+paint.width*(.6*phaseX/100+.2),y:paint.y+height/2}:null,clipVisible=!!paint&&clips.every(a=>((!['hidden','clip','auto','scroll'].includes(a.overflowX))||(paint.x>=a.rect.x-1&&paint.right<=a.rect.right+1))&&((!['hidden','clip','auto','scroll'].includes(a.overflowY))||(paint.y>=a.rect.y-1&&paint.bottom<=a.rect.bottom+1))),progress=e?{at:performance.now(),rect:r,paint,phaseX,center,clips,clipVisible,display:s.display,visibility:s.visibility,opacity:s.opacity,overflowY:s.overflowY,zIndex:s.zIndex,pointerEvents:s.pointerEvents,pseudo:{content:p.content,display:p.display,visibility:p.visibility,opacity:p.opacity,height:p.height,top:p.top,backgroundImage:p.backgroundImage,backgroundSize:p.backgroundSize,backgroundPositionX:p.backgroundPositionX,animationName:p.animationName,animationDuration:p.animationDuration,animationPlayState:p.animationPlayState},visible:s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0&&p.display!=='none'&&p.visibility==='visible'&&Number(p.opacity)>0&&height===2&&r.width>0&&clipVisible&&center.x>paint.x&&center.x<paint.right&&paint.y>=0&&paint.bottom<=innerHeight}:null;return{at:performance.now(),documentFocus:document.hasFocus(),visibility:document.visibilityState,fonts:document.fonts.status,stop:stop?{label:stop.getAttribute('aria-label'),disabled:stop.disabled,rect:rect(stop),svg:svg?{width:svg.getAttribute('width'),height:svg.getAttribute('height'),strokeWidth:svg.getAttribute('stroke-width'),className:svg.getAttribute('class'),html:svg.outerHTML}:null}:null,progress}})()`;
export const progressPhaseExpression=`(async()=>{const frames=[];for(let i=0;i<2;i++){await new Promise(resolve=>requestAnimationFrame(resolve));const d=${loadingExpression};frames.push(d.progress);}return frames;})()`;
export function assertProgressFrame(p){
 assert(p&&p.visible&&p.clipVisible,'Actual progress pseudo must paint visibly inside its owner');
 assert.equal(p.rect.height,0,'Original progress anchor intentionally has zero height');
 assert.equal(p.paint.height,2);assert.equal(p.pseudo.height,'2px');
 assert(p.rect.width>0&&p.paint.width===p.rect.width);
 assert.equal(p.visibility,'visible');assert.equal(p.pseudo.visibility,'visible');
 assert(Number(p.opacity)>0&&Number(p.pseudo.opacity)>0);
 assert(p.pseudo.content==='""'||p.pseudo.content==="''");
 assert(p.pseudo.backgroundImage.includes('linear-gradient'));
 assert.equal(p.pseudo.animationName,'bw-progress');assert.equal(p.pseudo.animationPlayState,'running');
 assert.equal(p.pseudo.animationDuration,'0.9s');
 assert(Number.isFinite(p.phaseX)&&p.phaseX>=-16&&p.phaseX<=116,'Gradient opaque center must be within the painted owner');
 assert(p.center.x>p.paint.x&&p.center.x<p.paint.right);
}
export function assertLoadingDescriptor(d){
 assert.equal(d.visibility,'visible');assert.equal(d.fonts,'loaded');
 assert(d.stop&&!d.stop.disabled);assert.equal(d.stop.label,'停止加载');
 assert.equal(d.stop.svg.width,'17');assert.equal(d.stop.svg.height,'17');
 assert.equal(d.stop.svg.strokeWidth,'1.65');assert(d.stop.svg.className.includes('lucide-x'));
 assert(d.stop.rect.width>0&&d.stop.rect.height>0);assertProgressFrame(d.progress);
}
export function loadingNativeBody(contentsId){return `const w=E.webContents.fromId(${contentsId});if(!w||w.isDestroyed())return{contentsId:${contentsId},destroyed:true};return{contentsId:w.id,url:w.getURL(),destroyed:false,loading:w.isLoading(),canGoBack:w.navigationHistory.canGoBack(),canGoForward:w.navigationHistory.canGoForward()};`;}
export function verifyLoadingControls(){
 const p={visible:true,clipVisible:true,rect:{height:0,width:479},paint:{x:0,right:479,width:479,height:2},visibility:'visible',opacity:'1',pseudo:{height:'2px',visibility:'visible',opacity:'1',content:'""',backgroundImage:'linear-gradient(90deg, transparent, rgb(51,133,255), transparent)',animationName:'bw-progress',animationPlayState:'running',animationDuration:'0.9s'},phaseX:40,center:{x:200}},d={visibility:'visible',fonts:'loaded',stop:{label:'停止加载',disabled:false,rect:{width:32,height:32},svg:{width:'17',height:'17',strokeWidth:'1.65',className:'lucide lucide-x'}},progress:p};
 assertLoadingDescriptor(d);let negative=0;
 for(const bad of[{...d,progress:{...p,visible:false}},{...d,progress:{...p,rect:{...p.rect,height:2}}},{...d,progress:{...p,pseudo:{...p.pseudo,height:'0px'}}},{...d,progress:{...p,clipVisible:false}},{...d,progress:{...p,phaseX:140}},{...d,stop:{...d.stop,svg:{...d.stop.svg,width:'16'}}},{...d,stop:{...d.stop,svg:{...d.stop.svg,strokeWidth:'2'}}}]){assert.throws(()=>assertLoadingDescriptor(bad));negative++;}
 return{positive:1,negative};
}
