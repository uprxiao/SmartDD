// Read-only own-App observations; no navigation/input/permission/DOM mutation.
import assert from 'node:assert/strict';
export const PAGE_READ=`(()=>({href:location.href,title:document.title,account:document.querySelector('header strong')?.textContent??null,total:document.querySelector('output#total')?.textContent??null,text:document.body?.innerText??'',readyState:document.readyState}))()`;
export function makePageReadBody({origin}){
 assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
 const body=`const ownOrigin=${JSON.stringify(origin)},contents=E.webContents.getAllWebContents().filter(w=>{try{return !w.isDestroyed()&&new URL(w.getURL()).origin===ownOrigin}catch{return false}});return Promise.all(contents.map(async w=>({webContentsId:w.id,url:w.getURL(),osPid:w.getOSProcessId(),document:await w.executeJavaScript(${JSON.stringify(PAGE_READ)},false)})));`;
 new Function('E',body);return body;
}
