// Finite recognition of the actual R008 stock CLI prompt. Never install/update or persist a choice.
import assert from 'node:assert/strict';
import {sha} from './io.mjs';
function screen(text){
 const lines=String(text??'').split(/\\n|\n/).map(x=>x.trim().replace(/^[│┃]\s?/,'').replace(/\s?[│┃]$/,'').trim());
 const start=lines.findIndex(x=>/^Update available\s*·\s*0\.166\.0\s*→\s*0\.167\.0$/.test(x));
 if(start<0)return null;
 const block=lines.slice(start,start+14),options=block.flatMap(x=>{const m=/^([›❯>])?\s*([123])[.)]\s+(.+)$/.exec(x);return m?[{selected:!!m[1],number:Number(m[2]),label:m[3]}]:[]});
 if(options.length!==3||options.map(x=>x.number).join(',')!=='1,2,3')return null;
 if(options[0].label!=='Update now (runs `npm install -g @openai/codex`)'||options[1].label!=='Skip'||options[2].label!=='Skip until next version')return null;
 if(!block.some(x=>/^enter continue\s*·\s*esc skip$/.test(x)))return null;
 const selected=options.filter(x=>x.selected);if(selected.length!==1)return null;
 return{selected:selected[0].number,signature:sha(JSON.stringify(options))};
}
export function explainUpdateMenu(value){const a=screen(value?.actualViewportScreen),b=screen(value?.currentScreen);return{recognized:!!a&&!!b&&a.signature===b.signature,selected:a?.selected??null,inputAllowed:value?.focused===true&&value?.activeInExactTerminal===true&&value?.activeClass?.includes('xterm-helper-textarea')&&value?.terminalVisible===true&&value?.viewportAtBottom===true};}
export async function dismissExactUpdateMenu({app,record,persist,poll,observe}){
 record.actions??=[];record.scope='Only actual 0.166.0→0.167.0 Update available; select2 Skip once. No update or permanent skip.';
 const initial=await poll(async()=>{const x=await observe('before-update-or-current-composer'),m=explainUpdateMenu(x.value);if(m.recognized)return{x,m};if(x.menu.recognized||x.composer.ready)return{x,m};return null;},15000);
 if(!initial.m.recognized){record.status='not-present';await persist();return;}
 assert(initial.m.inputAllowed&&initial.m.selected===1&&!record.enterAt,'Exact original update default1 and focused terminal required');
 async function key(name){await app.checkInputFocus('M12.StockUpdatePrompt.'+name);for(const type of ['keyDown','keyUp']){await app.cdp('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:name==='ArrowDown'?40:13,nativeVirtualKeyCode:name==='ArrowDown'?125:36,...(name==='Enter'&&type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})});record.actions.push({at:new Date().toISOString(),name,type});}await persist();}
 await key('ArrowDown');await poll(async()=>{const x=await observe('update-after-one-arrow'),m=explainUpdateMenu(x.value);return m.recognized&&m.inputAllowed&&m.selected===2?m:null;},5000);
 const before=explainUpdateMenu((await observe('update-before-skip-enter')).value);assert(before.recognized&&before.inputAllowed&&before.selected===2);
 record.enterAt=new Date().toISOString();record.selectedOption=2;record.selectedLabel='Skip';await key('Enter');
 await poll(async()=>{const x=await observe('update-after-skip'),m=explainUpdateMenu(x.value);return !m.recognized&&(x.menu.recognized||x.composer.ready)?x:null;},15000);
 record.status='skip-once-closed';record.installedOrUpdated=false;record.permanentChoice=false;record.businessPromptSentByThisEnter=false;await persist();
}
