// Shared test driver for isolated packaged-file acceptance, never daily user data.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {openElectron,pause} from '../lib/electron-harness.mjs';
export async function openFileAcceptanceApp({executable,projectPath,userData,name,existingProject,prepare}){
 const app=await openElectron({executable,userData}),{cdp,evaluate,invoke,waitFor}=app;
 const exists=selector=>`Boolean(document.querySelector(${JSON.stringify(selector)}))`;
 const key=async(key,code,modifiers=0)=>{const virtual={Enter:13,Space:32,Tab:9}[code],text=code==='Enter'?'\r':code==='Space'?' ':undefined;await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,...(virtual?{windowsVirtualKeyCode:virtual}:{}),...(text?{text,unmodifiedText:text}:{})});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,...(virtual?{windowsVirtualKeyCode:virtual}:{})});};
 const click=async(selector,text,index=0)=>{
  let point;const end=Date.now()+10000;
  while(!point){point=await evaluate(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`})[${index}];if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);if(!point){assert(Date.now()<end,'Missing actual file UI control');await pause(50);}}
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
 };
 const tree=relative=>`[role="treeitem"][title=${JSON.stringify(join(projectPath,relative))}]`;
 const open=async(relative)=>{const parts=relative.split('/');for(let i=1;i<parts.length;i++){const selector=tree(parts.slice(0,i).join('/'));await waitFor(exists(selector));if(await evaluate(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-expanded')==='false'`))await click(selector);}await click(tree(relative));await waitFor(`document.querySelector('.fw-tab [role=tab][aria-selected=true]')?.getAttribute('title')===${JSON.stringify(join(projectPath,relative))}`);};
 const project=existingProject??await invoke('projects.create',{name,aliases:[],description:'Isolated packaged-file acceptance',rulesPath:null},[{label:'Synthetic static viewers',path:projectPath}]);
 if(prepare)await prepare({app,project});
 await cdp('Page.reload');await waitFor(exists(`[data-project-id="${project.id}"]`));await click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`);await click('[data-testid=sidebar-project-edit]');await waitFor(exists('[data-testid=project-files]'));await click('[data-testid=project-files]');
 return{...app,exists,key,click,tree,open,project};
}
