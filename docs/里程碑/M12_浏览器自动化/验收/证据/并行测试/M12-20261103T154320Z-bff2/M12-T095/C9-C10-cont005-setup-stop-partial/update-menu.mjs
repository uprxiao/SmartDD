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
// A closed update menu is not Native/send readiness. Only the exact observed stock resume screen is accepted here.
export function explainClosedUpdateToResume(v,{expectedPtyId}){
 const rejectReasons=[],fail=(ok,name)=>{if(!ok)rejectReasons.push(name)};const c=v?.activeCursor??{},current=v?.currentScreen??'',viewport=v?.actualViewportScreen??'';
 fail(typeof expectedPtyId==='string'&&expectedPtyId.length>0&&v?.ptyId===expectedPtyId,'exact-current-pty');fail(v?.focused===true&&v?.activeInExactTerminal===true&&v?.activeClass?.includes('xterm-helper-textarea'),'exact-terminal-focus');fail(v?.terminalVisible===true&&v?.viewportAtBottom===true&&c.inViewport===true,'visible-bottom-cursor');fail(v?.valueLength===0&&/^\s*›\s*$/.test(c.before??'')&&c.after==='Ask Codex to do anything'&&(c.line??'').trimEnd()===((c.before??'')+c.after).trimEnd(),'exact-empty-stock-composer');
 fail(typeof current==='string'&&current.length>0&&current===viewport,'current-and-viewport-identical');fail(!screen(current)&&!screen(viewport)&&!explainUpdateMenu(v).recognized,'update-menu-gone-both-screens');
 const lines=current.split(/\\n|\n/).map(x=>x.trim()).filter(Boolean),resuming=x=>/^Resuming session(?:…|\.{3})$/.test(x),directory=x=>/^\/private\/tmp\/(?:…|\.\.\.|willyou-m12-t095-App027-A-R-prep-004)\/runtime-001\/project$/.test(x),known=x=>x==='>_ OpenAI Codex (v0.166.0)'||directory(x)||resuming(x)||x==='› Ask Codex to do anything'||x==='? for shortcuts';
 fail(lines.length===5&&lines.every(known)&&lines.filter(resuming).length===1&&lines.filter(directory).length===1&&lines.filter(x=>x==='>_ OpenAI Codex (v0.166.0)').length===1&&lines.filter(x=>x==='› Ask Codex to do anything').length===1&&lines.filter(x=>x==='? for shortcuts').length===1,'exact-observed-resuming-screen-no-unknown-prompt');
 return{closedToResumeWait:rejectReasons.length===0,rejectReasons,expectedPtyId,observedPtyId:v?.ptyId??null,businessReady:false,scope:'Menu lifecycle only; unchanged outer120s fresh-settings/no-Resuming/once-send/ACK still required'};
}
export async function dismissExactUpdateMenu({app,record,persist,poll,observe,expectedPtyId}){
 record.actions??=[];record.scope='Only actual 0.166.0→0.167.0 Update available; select2 Skip once. No update or permanent skip.';
 const initial=await poll(async()=>{const x=await observe('before-update-or-current-composer'),m=explainUpdateMenu(x.value);assert(typeof expectedPtyId==='string'&&expectedPtyId.length>0&&x.value.ptyId===expectedPtyId,'Original bound task PTY required');const resume=explainClosedUpdateToResume(x.value,{expectedPtyId});if(resume.closedToResumeWait)return{x,m,closedToResumeWait:resume};if(m.recognized)return{x,m};if(x.menu.recognized||x.composer.ready)return{x,m};return null;},15000);
 if(initial.closedToResumeWait){record.status='menu-not-present/resume-wait';record.closedToResumeWait=initial.closedToResumeWait;record.businessPromptSentByThisEnter=false;await persist();return;}
 if(!initial.m.recognized){record.status='not-present';await persist();return;}
 assert(initial.m.inputAllowed&&initial.m.selected===1&&!record.enterAt,'Exact original update default1 and focused terminal required');assert.equal(initial.x.value.ptyId,expectedPtyId);
 async function key(name){await app.checkInputFocus('M12.StockUpdatePrompt.'+name);for(const type of ['keyDown','keyUp']){await app.cdp('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:name==='ArrowDown'?40:13,nativeVirtualKeyCode:name==='ArrowDown'?125:36,...(name==='Enter'&&type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})});record.actions.push({at:new Date().toISOString(),name,type});}await persist();}
 await key('ArrowDown');await poll(async()=>{const x=await observe('update-after-one-arrow'),m=explainUpdateMenu(x.value);return m.recognized&&m.inputAllowed&&m.selected===2?m:null;},5000);
 const before=explainUpdateMenu((await observe('update-before-skip-enter')).value);assert(before.recognized&&before.inputAllowed&&before.selected===2);
 record.enterAt=new Date().toISOString();record.selectedOption=2;record.selectedLabel='Skip';await key('Enter');
 const closed=await poll(async()=>{const x=await observe('update-after-skip'),m=explainUpdateMenu(x.value),resume=explainClosedUpdateToResume(x.value,{expectedPtyId});if(resume.closedToResumeWait)return{...x,closedToResumeWait:resume};return !m.recognized&&(x.menu.recognized||x.composer.ready)?x:null;},15000);
 record.status=closed.closedToResumeWait?'closed-to-resume-wait':'skip-once-closed';record.closedToResumeWait=closed.closedToResumeWait??null;record.installedOrUpdated=false;record.permanentChoice=false;record.businessPromptSentByThisEnter=false;await persist();
}
