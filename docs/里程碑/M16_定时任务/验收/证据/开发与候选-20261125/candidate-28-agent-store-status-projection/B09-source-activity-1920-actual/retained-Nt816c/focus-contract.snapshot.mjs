import assert from 'node:assert/strict';
export function focusPlan(o){
 assert(o.browserAddress&&o.browserViewport&&o.actualSeparator,'A real visible browser context, not directory-only panel, is required');
 assert(Number.isFinite(o.existingBrowserWidth)&&Number.isFinite(o.target)&&o.target>=o.min&&o.target<=o.max,'Target must be reachable by real keyboard steps');
 if(Math.abs(o.existingBrowserWidth-o.target)<=1)return 'already-exact-browser-width';
 return 'browser-address-reverse-tab';
}
