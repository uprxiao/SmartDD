// N01/N02: per-region contrast, theme proof, layout box and a clipped screenshot, shared by the A and P drivers.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {regionContrast} from './visual-audit-lib.mjs';

export const box = (app, selector) => app.evaluate(`((s)=>{const e=document.querySelector(s);if(!e)return null;const cs=getComputedStyle(e),b=e.getBoundingClientRect();return{w:Math.round(b.width*10)/10,h:Math.round(b.height*10)/10,padding:cs.padding,margin:cs.margin,border:cs.borderTopWidth+' '+cs.borderTopStyle+' '+cs.borderTopColor,radius:cs.borderTopLeftRadius,shadow:cs.boxShadow,bg:cs.backgroundColor}})(${JSON.stringify(selector)})`);

export const themeProof = (app) => app.evaluate(`(()=>{const rgb=getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number);const lum=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255;return{html:document.documentElement.className,dataTheme:document.documentElement.dataset.theme??null,bodyBg:getComputedStyle(document.body).backgroundColor,lum:Math.round(lum*1000)/1000}})()`);

// Contrast of the primary text and icon color against the effective background, plus layout box and a clipped PNG.
export async function captureRegion(app, dir, key, {root, text, icon}) {
  const rec = {key, root, text, icon, found: !!(await box(app, root))};
  assert(rec.found, `${key}: region root not found (${root})`);
  rec.box = await box(app, root);
  if (text) { rec.text = await regionContrast(app, text); assert(rec.text, `${key}: text target missing (${text})`); }
  if (icon) { rec.icon = await regionContrast(app, icon); assert(rec.icon, `${key}: icon target missing (${icon})`); }
  const clip = await app.evaluate(`((s)=>{const b=document.querySelector(s).getBoundingClientRect();const x=Math.max(0,b.x-4),y=Math.max(0,b.y-4);return{x,y,width:Math.min(innerWidth-x,b.width+8),height:Math.min(innerHeight-y,b.height+8),scale:1}})(${JSON.stringify(root)})`);
  const shot = await app.cdp('Page.captureScreenshot', {format: 'png', clip});
  rec.screenshot = key.replace(/[^A-Za-z0-9_-]/g, '_') + '.png'; await writeFile(join(dir, rec.screenshot), Buffer.from(shot.data, 'base64'));
  return rec;
}

export function assertRegion(rec, mode) {
  if (rec.text) assert(rec.text.ratio >= 4.5, `${rec.key} ${mode}: text contrast ${rec.text.ratio} < 4.5 (${rec.text.fg} on ${rec.text.bg})`);
  if (rec.icon) assert(rec.icon.ratio >= 3, `${rec.key} ${mode}: icon contrast ${rec.icon.ratio} < 3 (${rec.icon.fg} on ${rec.icon.bg})`);
}
export function assertTheme(proof, mode) {
  if (mode === 'light') assert(proof.lum > 0.8, 'light theme body is not light: ' + JSON.stringify(proof)); else assert(proof.lum < 0.25, 'dark theme body is not dark: ' + JSON.stringify(proof));
}
