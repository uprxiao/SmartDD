import assert from 'node:assert/strict';
import { pause } from './electron-harness.mjs';

// Read-only focus, layout and animation observations. All actions use CDP input.
// Findings are partial evidence, never an automatic case-status promotion.
export async function runPdfNavigation(app, { prototype = false, theme, record, screenshot }) {
  const host = prototype ? '.fa-pdf-scroll' : '.fw-pdf-scroll';
  const menu = prototype ? '.fw-zoom-menu' : '[role=menu]';
  const nav = '[aria-label="PDF 页面缩略图"]';
  const snapshot = () => app.evaluate(`(() => {
    const h=document.querySelector(${JSON.stringify(host)}),n=document.querySelector(${JSON.stringify(nav)}),a=document.activeElement;
    const rect=e=>{const b=e.getBoundingClientRect();return{left:b.left,top:b.top,width:b.width,height:b.height,right:b.right,bottom:b.bottom}};
    const hb=rect(h),nb=rect(n);
    return {focus:document.hasFocus(),active:a&&{tag:a.tagName,label:a.getAttribute('aria-label'),role:a.getAttribute('role'),text:a.textContent.slice(0,80)},
      zoom:document.querySelector('[aria-label="PDF 缩放"]').textContent,menu:!!document.querySelector(${JSON.stringify(menu)}),scrollTop:h.scrollTop,host:hb,
      nav:{...nb,hover:n.matches(':hover'),focusWithin:n.matches(':focus-within'),inert:n.inert,ariaHidden:n.getAttribute('aria-hidden'),docked:!!n.querySelector('[aria-label="取消停靠缩略图"]')},
      current:n.querySelector('[aria-current=page]')?.getAttribute('aria-label'),
      pages:[...h.querySelectorAll('article[data-page]')].map(e=>{const b=rect(e),visible=Math.max(0,Math.min(b.bottom,hb.bottom)-Math.max(b.top,hb.top));return{number:+e.dataset.page,...b,visible,ratio:visible/b.height}}),
      buttons:[...document.querySelectorAll('.fw-toolbar button,.fw-pdf button,.fw-artifact-tools button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({label:e.getAttribute('aria-label'),text:e.textContent.slice(0,80),tabIndex:e.tabIndex,disabled:e.disabled}))};
  })()`);
  const settle = () => app.evaluate(`(async()=>{let last='',stable=0;for(let i=0;i<600;i++){await new Promise(requestAnimationFrame);const h=document.querySelector(${JSON.stringify(host)}),n=document.querySelector(${JSON.stringify(nav)});const next=[h.scrollTop,n.getBoundingClientRect().width].join(':');stable=next===last?stable+1:0;last=next;if(stable>=10)return true}throw Error('PDF layout/scroll did not settle')})()`);
  const frames = async count => app.evaluate(`(async()=>{for(let i=0;i<${count};i++)await new Promise(requestAnimationFrame);return true})()`);
  await app.waitFor(`document.querySelector(${JSON.stringify(host + ' article[data-page="1"] canvas')})?.dataset.rendered==='true'`);
  await app.evaluate(`(()=>{const trace={keys:[],scroll:[]};trace.key=e=>trace.keys.push({key:e.key,code:e.code,trusted:e.isTrusted,prevented:e.defaultPrevented,target:e.target.getAttribute?.('aria-label'),role:e.target.getAttribute?.('role'),at:performance.now()});trace.scrollHandler=()=>trace.scroll.push({at:performance.now(),top:document.querySelector(${JSON.stringify(host)}).scrollTop});window.addEventListener('keydown',trace.key);trace.node=document.querySelector(${JSON.stringify(host)});trace.node.addEventListener('scroll',trace.scrollHandler,{passive:true});window.__pdfNavigationTrace=trace;return true})()`);
  try {
    await app.click('[aria-label="PDF 缩放"]');await app.waitFor('!!document.querySelector('+JSON.stringify(menu)+')');if(!prototype)await app.waitFor('document.querySelector(\'[role=menu]\')?.contains(document.activeElement)');
    const open = await snapshot();
    await app.key('Escape', 'Escape'); await app.waitFor('!document.querySelector('+JSON.stringify(menu)+')'); await frames(8);
    const escaped = await snapshot();
    await record('M9-T-T02', theme, 'original menu Escape and focused target', {open, escaped, keys:await app.evaluate('__pdfNavigationTrace.keys')});
    if (escaped.menu) await app.click('[aria-label="PDF 缩放"]');
    await app.click('[aria-label="PDF 缩放"]');
    await app.click(prototype ? '.fw-zoom-menu [role^=menuitem]' : '[role=menuitem]', '100%');
    await app.waitFor('document.querySelector(\'[aria-label="PDF 缩放"]\').textContent.includes("100%")');
    await app.key('Tab','Tab'); await frames(2); const tab1=await snapshot();
    await app.key('Tab','Tab'); await frames(2); const tab2=await snapshot();
    await record('M9-T-T02',theme,'toolbar keyboard focus after menu selection',{tab1,tab2,keys:await app.evaluate('__pdfNavigationTrace.keys')});
    // Move to the body to leave hover; keyboard focus is not manually reassigned.
    let s=await snapshot();
    await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:s.host.left+s.host.width/2,y:s.host.top+80});
    await app.click('[aria-label="PDF 缩放"]');await app.waitFor('!!document.querySelector('+JSON.stringify(menu)+')');if(!prototype)await app.waitFor('document.querySelector(\'[role=menu]\')?.contains(document.activeElement)'); await app.key('Escape','Escape'); await app.waitFor('!document.querySelector('+JSON.stringify(menu)+')'); await frames(10);
    s=await snapshot(); if(s.menu)await app.click('[aria-label="PDF 缩放"]');
    const collapsed=await snapshot();
    await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:collapsed.nav.left+6,y:collapsed.nav.top+60});await settle();const hovered=await snapshot();
    await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:hovered.host.left+hovered.host.width/2,y:hovered.host.top+80});await settle();const left=await snapshot();
    await app.click('[aria-label="停靠缩略图"]');await app.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:left.host.left+150,y:left.host.top+80});await settle();const docked=await snapshot();
    await record('M9-T-T07',theme,'collapsed rail, hover, leave and dock geometry',{collapsed,hovered,left,docked});
    for(const number of [3,2,1]) {
      await app.evaluate('__pdfNavigationTrace.scroll=[]');const before=await snapshot();
      await app.click(nav+' [aria-label="第 '+number+' 页"]');
      const immediate=await snapshot();await settle();const after=await snapshot();
      const timeline=await app.evaluate('__pdfNavigationTrace.scroll');
      const intermediatePositions=[...new Set(timeline.map(x=>x.top))].filter(x=>x!==before.scrollTop&&x!==after.scrollTop);
      await record('M9-T-T08',theme,'thumbnail '+number+' real scroll timeline',{before,immediate,after,timeline,intermediatePositions});
      if(process.env.WILLYOU_PDF_NAV_STRICT==='1'){assert(intermediatePositions.length>1,'Expected actual smooth scroll positions');assert.equal(after.current,'第 '+number+' 页');}
    }
    s=await snapshot();
    const delta=s.pages.find(x=>x.number===1).height-s.host.height*.45;
    await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',x:s.host.left+s.host.width/2,y:s.host.top+100,deltaX:0,deltaY:delta});
    await settle();const mostVisible=await snapshot();
    const expected=mostVisible.pages.toSorted((a,b)=>b.ratio-a.ratio)[0].number;
    await record('M9-T-T08',theme,'manual scroll most-visible page comparison',{delta,after:mostVisible,expected,agrees:mostVisible.current==='第 '+expected+' 页'});
    if(process.env.WILLYOU_PDF_NAV_STRICT==='1')assert.equal(mostVisible.current,'第 '+expected+' 页');
    await app.click(nav+' [aria-label="第 2 页"]');await settle();const beforeClose=await snapshot();assert.equal(beforeClose.current,'第 2 页');
    await app.click('[aria-label="关闭 normal.pdf"]');await app.waitFor('!document.querySelector(".fw-pdf")');
    if(prototype)await app.click('.fw-empty button','重新打开关闭的文件');else{await app.click('[aria-label="文件菜单"]');await app.click('.fw-file-menu [role=menuitem]','重新打开关闭的文件');}
    await app.waitFor(`document.querySelector(${JSON.stringify(host+' article[data-page="2"] canvas')})?.dataset.rendered==='true'`);await settle();const reopened=await snapshot();
    await record('M9-T-T08',theme,'close and reopen restores the specified page without stealing later scroll',{beforeClose,reopened});
    if(process.env.WILLYOU_PDF_NAV_STRICT==='1')assert.equal(reopened.current,'第 2 页');
    await app.cdp('Input.dispatchMouseEvent',{type:'mouseWheel',x:reopened.host.left+150,y:reopened.host.top+100,deltaX:0,deltaY:-10000});await settle();const userScrolled=await snapshot();
    await record('M9-T-T08',theme,'user scroll after restore remains authoritative',{after:userScrolled});
    if(process.env.WILLYOU_PDF_NAV_STRICT==='1'){assert.equal(userScrolled.current,'第 1 页');assert.equal(userScrolled.scrollTop,0);}
    await screenshot();
  } finally {
    await app.evaluate(`(()=>{const t=window.__pdfNavigationTrace;if(t){window.removeEventListener('keydown',t.key);t.node?.removeEventListener('scroll',t.scrollHandler)}delete window.__pdfNavigationTrace;return true})()`);
  }
}
