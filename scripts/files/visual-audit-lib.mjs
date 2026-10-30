// N01/N02/N04/N05: icon inventory, per-control state audit and region contrast shared by the A and P drivers.
import assert from 'node:assert/strict';
import {mouse} from './n-case-kit.mjs';

// Every visible svg icon inside the scope with its owner label, size, stroke and mirror state.
export function auditIcons(app, scope) {
  return app.evaluate(`((scope)=>{const root=document.querySelector(scope);if(!root)return null;const out=[];for(const svg of root.querySelectorAll('svg')){const r=svg.getBoundingClientRect();if(!r.width||!r.height)continue;
    const owner=svg.closest('button,[role=treeitem],[role=tab],[role=menuitem],a,summary,label,span'),cs=getComputedStyle(svg);
    let mirror=false;for(let e=svg;e&&e!==owner?.parentElement;e=e.parentElement){const m=new DOMMatrix(getComputedStyle(e).transform==='none'?undefined:getComputedStyle(e).transform);if(m.a<0)mirror=true}
    const cls=[...svg.classList];const lucide=cls.find(c=>c.startsWith('lucide-'))||null;
    out.push({owner:(owner?.getAttribute('aria-label')||owner?.title||owner?.textContent||'').trim().slice(0,28),ownerTag:owner?.tagName,lucide,fileIcon:cls.includes('fw-file-icon'),width:r.width,height:r.height,
      strokeWidthAttr:svg.getAttribute('stroke-width'),strokeWidth:cs.strokeWidth,fillAttr:svg.getAttribute('fill'),stroke:cs.stroke,color:cs.color,mirror,use:svg.querySelector('use')?.getAttribute('href')?.split('#').pop()||null})}
    return out})(${JSON.stringify(scope)})`);
}

const STYLE = `(e)=>{const cs=getComputedStyle(e),b=e.getBoundingClientRect();return{color:cs.color,bg:cs.backgroundColor,border:cs.borderTopColor+' '+cs.borderTopWidth,radius:cs.borderTopLeftRadius,shadow:cs.boxShadow,outline:cs.outlineStyle+' '+cs.outlineWidth+' '+cs.outlineColor,opacity:cs.opacity,cursor:cs.cursor,pe:cs.pointerEvents,w:Math.round(b.width*10)/10,h:Math.round(b.height*10)/10,focusVisible:e.matches(':focus-visible'),hover:e.matches(':hover')}}`;

// Enumerate interactive controls and capture default / hover / focus-visible styles plus disabled and selected flags.
export async function auditControls(app, scope, {maxTree = 2} = {}) {
  const list = await app.evaluate(`((scope)=>{const root=document.querySelector(scope);const sel='button,[role=tab],[role=treeitem],input:not([type=hidden]),select,textarea,[role=button],a[href]';let tree=0;const out=[];for(const e of root.querySelectorAll(sel)){const b=e.getBoundingClientRect();if(!b.width||!b.height||b.bottom<0||b.top>innerHeight||b.right<0||b.left>innerWidth)continue;if(e.getAttribute('role')==='treeitem'&&tree++>=${maxTree})continue;
    e.setAttribute('data-audit-i',String(out.length));out.push({i:out.length,tag:e.tagName.toLowerCase(),role:e.getAttribute('role'),label:(e.getAttribute('aria-label')||e.title||e.placeholder||e.textContent||'').trim().slice(0,28),cls:(e.className||'').toString().slice(0,50)})}return out})(${JSON.stringify(scope)})`);
  const style = (i) => app.evaluate(`(${STYLE})(document.querySelector('[data-audit-i="${i}"]'))`);
  const rows = [];
  for (const c of list) {
    const sel = `[data-audit-i="${c.i}"]`;
    const flags = await app.evaluate(`((e)=>({disabled:e.disabled===true||e.getAttribute('aria-disabled')==='true',selected:e.getAttribute('aria-selected')==='true'||e.getAttribute('aria-pressed')==='true'||e.classList.contains('selected')||e.classList.contains('active')||e.classList.contains('current'),expanded:e.getAttribute('aria-expanded')}))(document.querySelector('${sel}'))`);
    const def = await style(c.i);
    let hover = null, focus = null;
    if (!flags.disabled) {
      // Re-measure and retry (bounded): layout can shift after scrollIntoView or the previous control's blur.
      for (let attempt = 0; attempt < 3 && !(hover && hover.hover); attempt++) {
        const rect = await app.evaluate(`((e)=>{e.scrollIntoView({block:'nearest',inline:'nearest'});const b=e.getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})(document.querySelector('${sel}'))`);
        await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 1, y: 1}); await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: rect.x, y: rect.y});
        await app.waitFor(`document.querySelector('${sel}').matches(':hover')`, 1500).catch(() => {});
        await app.evaluate('new Promise(r=>setTimeout(r,60))'); hover = await style(c.i);
      }
    } else hover = await style(c.i);
    await app.cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 1, y: 1}); await app.evaluate('new Promise(r=>setTimeout(r,40))');
    if (!flags.disabled) {
      for (let attempt = 0; attempt < 3 && !(focus && focus.focusVisible); attempt++) { await app.evaluate(`document.querySelector('${sel}').focus({focusVisible:true})`); await app.evaluate('new Promise(r=>setTimeout(r,40))'); focus = await style(c.i); }
      await app.evaluate(`document.activeElement?.blur()`);
    }
    rows.push({...c, flags, default: def, hover, focus});
  }
  await app.evaluate(`document.querySelectorAll('[data-audit-i]').forEach(e=>e.removeAttribute('data-audit-i'))`);
  return rows;
}

// Effective background of an element (first non-transparent ancestor) and WCAG contrast against its text color.
export function regionContrast(app, selector) {
  return app.evaluate(`((sel)=>{const e=document.querySelector(sel);if(!e)return null;const parse=s=>{const m=s.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(',').map(Number);return{r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1}};
    const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b)};
    let bg=null;for(let x=e;x;x=x.parentElement){const c=parse(getComputedStyle(x).backgroundColor);if(c&&c.a>0.95){bg=c;break}}if(!bg)bg={r:255,g:255,b:255,a:1};
    const cs=getComputedStyle(e),fg=parse(cs.color)||{r:0,g:0,b:0,a:1};const l1=lum(fg),l2=lum(bg),ratio=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
    return{fg:cs.color,bg:'rgb('+bg.r+','+bg.g+','+bg.b+')',ratio:Math.round(ratio*100)/100,fontSize:cs.fontSize,text:e.textContent.trim().slice(0,20)}})(${JSON.stringify(selector)})`);
}
