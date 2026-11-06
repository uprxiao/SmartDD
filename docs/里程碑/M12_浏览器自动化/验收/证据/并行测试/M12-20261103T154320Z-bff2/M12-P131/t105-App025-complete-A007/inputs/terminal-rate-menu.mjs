// Stock Codex0.166 exact rate-limit reminder only. No model/config/approval changes.
import assert from 'node:assert/strict';
import {writeFile,appendFile} from 'node:fs/promises';
import {sha} from './io.mjs';
import {readExactTerminal} from './terminal-model.mjs';
import {explainEmptyComposer} from './composer-readiness.mjs';
const labels={1:'Switch to gpt-6-luna',2:'Keep current model',3:'Keep current model (never show again)'};
const lines=text=>String(text??'').split(/\\n|\n/).map(line=>line.trim().replace(/^[│┃]\s?/, '').replace(/\s?[│┃]$/,'').trim());
const heading=line=>line.replace(/^[╭╮╰╯┌┐└┘─━\s]+|[╭╮╰╯┌┐└┘─━\s]+$/g,'')==='Approaching rate limits';
function analyzeScreen(text){
 const all=lines(text),headers=all.flatMap((line,index)=>heading(line)?[index]:[]),candidate=all.some(line=>heading(line)||/^[›❯>]\s*[1-9][.)]\s+\S/.test(line));
 if(headers.length!==1)return{recognized:false,candidate,reasons:['exact-single-menu-heading-missing'],selected:null};
 const block=all.slice(headers[0]+1,headers[0]+16),options=block.flatMap((line,index)=>{const match=/^([›❯>])?\s*([123])[.)]\s+(.+)$/.exec(line);return match?[{number:Number(match[2]),selected:!!match[1],label:match[3],line:index+headers[0]+1}]:[];});
 if(options.length!==3||options.map(option=>option.number).join(',')!=='1,2,3')return{recognized:false,candidate:true,reasons:['exact-three-options-missing-or-ambiguous'],selected:null};
 if(!block.some(line=>/^enter select\s*·\s*esc back$/i.test(line)))return{recognized:false,candidate:true,reasons:['expected-enter-select-esc-back-footer-missing'],selected:null};
 for(const option of options){const equal=option.number===1?option.label.toLowerCase()===labels[1].toLowerCase():option.label===labels[option.number];if(!equal)return{recognized:false,candidate:true,reasons:['unexpected-option-text'],selected:null};}
 const selected=options.filter(option=>option.selected);if(selected.length!==1)return{recognized:false,candidate:true,reasons:['exact-selected-marker-missing-or-ambiguous'],selected:null};
 return{recognized:true,candidate:true,reasons:[],selected:selected[0].number,labels:options.map(({number,label})=>({number,label})),signature:sha(JSON.stringify(options.map(({number,label,selected})=>({number,label,selected}))))};
}
export function explainRateLimitMenu(value){
 if(!value)return{recognized:false,candidate:false,selected:null,reasons:['model-not-found'],inputAllowed:false};
 const actual=analyzeScreen(value.actualViewportScreen),current=analyzeScreen(value.currentScreen),same=actual.recognized&&current.recognized&&actual.signature===current.signature;
 const inputAllowed=value.focused===true&&value.activeInExactTerminal===true&&value.activeClass?.includes('xterm-helper-textarea')&&value.terminalVisible===true&&value.viewportAtBottom===true;
 return{...actual,recognized:!!same,candidate:actual.candidate||current.candidate,reasons:same?[]:[...new Set([...actual.reasons,...current.reasons,'current-and-actual-viewport-menu-must-match'])],inputAllowed:!!inputAllowed};
}
const safeObservation=(value,menu,composer)=>({ptyId:value?.ptyId,screenSHA256:sha(String(value?.currentScreen??'')),viewportSHA256:sha(String(value?.actualViewportScreen??'')),screenLength:value?.currentScreen?.length??0,viewportLength:value?.actualViewportScreen?.length??0,focus:{focused:value?.focused,activeInExactTerminal:value?.activeInExactTerminal,terminalVisible:value?.terminalVisible,viewportAtBottom:value?.viewportAtBottom},cursor:{inViewport:value?.activeCursor?.inViewport,beforeLength:value?.activeCursor?.before?.length??null,afterLength:value?.activeCursor?.after?.length??null,lineLength:value?.activeCursor?.line?.length??null},valueLength:value?.valueLength,menu,composer:{ready:composer.ready,emptyComposer:composer.emptyComposer,stockPlaceholderAccepted:composer.stockPlaceholderAccepted,rejectReasons:composer.rejectReasons}});

export function terminalReadinessRecorder({app,ptyId,record,persist,privatePath}){
 record.privateSamplesPath=privatePath;let initialized=false;
 return async function observe(label){
  const value=await readExactTerminal(app,ptyId);if(value)assert.equal(value.ptyId,ptyId);const menu=explainRateLimitMenu(value),composer=explainEmptyComposer(value),at=new Date().toISOString();
  // Full real terminal remains private. Persist this exact sample before any menu input or gate decision.
  if(!initialized){await writeFile(privatePath,'',{flag:'wx',mode:0o600});initialized=true;}
  await appendFile(privatePath,JSON.stringify({at,label,terminal:value,menu,composer})+'\n',{mode:0o600});
  const sample={at,label,...safeObservation(value,menu,composer)};record.samples??=[];record.samples.push(sample);record.privateSamplesPath=privatePath;await persist();return{value,menu,composer,sample};
 };
}
async function key(app,name,record,persist){
 assert(['ArrowDown','Enter'].includes(name));await app.checkInputFocus('T105.StockRateMenu.'+name);const down=name==='ArrowDown'?40:13;
 for(const type of['keyDown','keyUp']){await app.cdp('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:down,nativeVirtualKeyCode:name==='ArrowDown'?125:36,...(name==='Enter'&&type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})});record.actions.push({at:new Date().toISOString(),kind:'stock-rate-menu-key',key:name,type});}await persist();
}
export async function dismissExactRateLimitMenu({app,ptyId,record,persist,poll,observe}){
 record.actions??=[];record.scope='Only exact Approaching rate limits / 1 Switch to gpt-6-luna / 2 Keep current model / 3 never show again. Never switch model or persist dismissal.';
 try{
  const initial=await poll(async()=>{const state=await observe('before-menu-or-composer');if(state.menu.recognized)return state;if(!state.menu.candidate&&state.composer.ready)return state;return null;},15000);
  if(!initial.menu.recognized){record.status='menu-not-present-original-composer-observed';await persist();return;}
  assert(initial.menu.inputAllowed,'Actual terminal focus required before menu keys');assert.equal(initial.menu.selected,1,'Only known default option1 is supported; do not act on an unexpected selected item');assert(!record.arrowDownAt&&!record.enterAt,'Rate menu can be handled at most once');
  const beforeArrow=await observe('immediately-before-arrow');assert(beforeArrow.menu.recognized&&beforeArrow.menu.inputAllowed&&beforeArrow.menu.selected===1);assert.equal(beforeArrow.menu.signature,initial.menu.signature);
  record.arrowDownAt=new Date().toISOString();await key(app,'ArrowDown',record,persist);
  await poll(async()=>{const state=await observe('after-one-arrow-await-selected2');if(state.menu.recognized&&state.menu.inputAllowed&&state.menu.selected===2)return state;return null;},5000);
  const beforeEnter=await observe('immediately-before-option2-enter');assert(beforeEnter.menu.recognized&&beforeEnter.menu.inputAllowed&&beforeEnter.menu.selected===2,'Must observe actual selected Keep current model before Enter');
  record.selectedOption=2;record.selectedLabel=labels[2];record.enterAt=new Date().toISOString();record.businessPromptSubmittedByThisEnter=false;await key(app,'Enter',record,persist);
  await poll(async()=>{const state=await observe('after-option2-await-original-empty-composer');return !state.menu.candidate&&state.composer.ready?state:null;},15000);
  record.status='option2-keep-current-model-once-observed-closed';record.configurationAPICalled=false;record.permanentChoice=false;record.switchedModel=false;await persist();
 }catch(error){record.status='unhandled-or-unverified-menu-no-further-input';record.failure={name:error.name,messageSHA256:sha(String(error.stack??error))};await observe('menu-handler-failure').catch(()=>{});await app.screenshot(record.privateSamplesPath.replace(/\.jsonl$/,'.png')).catch(()=>{});await persist();throw error;}
}
export async function waitOriginalComposerLogged({app,record,persist,poll,observe}){
 try{return await poll(async()=>{const state=await observe('original-empty-composer-gate');return !state.menu.candidate&&state.composer.ready?state:null;},15000);}
 catch(error){record.originalComposerGateTimedOut=true;await observe('original-composer-gate-failure').catch(()=>{});await app.screenshot(record.privateSamplesPath.replace(/\.jsonl$/,'.png')).catch(()=>{});await persist();throw error;}
}
