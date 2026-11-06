// Pure finite text controls. No App/Native/CLI/OS/auth execution.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {ROOT} from './io.mjs';
import {explainRateLimitMenu} from './terminal-rate-menu.mjs';
const render=(selected=1,separator='\n')=>['Approaching rate limits','',...['Switch to gpt-6-luna','Keep current model','Keep current model (never show again)'].map((label,index)=>(selected===index+1?'› ':'  ')+(index+1)+'. '+label),'','enter select · esc back'].join(separator);
const model=text=>({ptyId:'synthetic-parser-control',currentScreen:text,actualViewportScreen:text,focused:true,activeInExactTerminal:true,activeClass:'xterm-helper-textarea',terminalVisible:true,viewportAtBottom:true});
const controls=[];
for(const [name,text,selected]of[['default1-real-newline',render(1),1],['selected2-literal-backslash-n',render(2,'\\n'),2]]){const value=explainRateLimitMenu(model(text));assert(value.recognized&&value.inputAllowed&&value.selected===selected);controls.push({name,pass:true,selected,controlOnly:true});}
for(const [name,text]of[
 ['wrong-recommended-model',render(1).replace('gpt-6-luna','other-model')],
 ['wrong-permanent-choice-text',render(1).replace('(never show again)','(always approve)')],
 ['missing-header',render(1).replace('Approaching rate limits','Unknown popup')],
 ['missing-footer',render(1).replace('enter select · esc back','unknown action')],
 ['ambiguous-two-selected',render(1).replace('  2.','› 2.')]
]){const value=explainRateLimitMenu(model(text));assert(!value.recognized);controls.push({name,pass:true,recognized:false,controlOnly:true});}
const selected3=explainRateLimitMenu(model(render(3)));assert(selected3.recognized&&selected3.selected===3);controls.push({name:'recognize-selected3-but-action-precondition-requires1',pass:true,selected:3,handlerMustReject:true,controlOnly:true});
const mismatch=model(render(1));mismatch.actualViewportScreen=render(2);assert(!explainRateLimitMenu(mismatch).recognized);controls.push({name:'current-vs-actual-viewport-mismatch-rejected',pass:true,controlOnly:true});
const noFocus=model(render(1));noFocus.focused=false;assert(!explainRateLimitMenu(noFocus).inputAllowed);controls.push({name:'no-actual-focus-never-input',pass:true,controlOnly:true});
await writeFile(ROOT+'/rate-menu-controls.json',JSON.stringify({schema:'stock-rate-menu-finite-controls-v1',controls,passed:controls.length,total:controls.length,source:'Exact public fixed Codex0.166 labels plus Root visual confirmation of A006 original PNG; render layouts in these controls are synthetic, not new Native evidence',nativeExecution:false,authReadOrCopy:false,formalNewPasses:0},null,2)+'\n');console.log(JSON.stringify({passed:controls.length,total:controls.length,nativeExecution:false,formalNewPasses:0}));
