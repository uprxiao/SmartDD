// Pure protocol/source checks; AppleScript is neither compiled nor executed here.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {activationIdentityExpression,parseActivationReply} from './activate-initial-exact-pid.mjs';
const root=new URL('.',import.meta.url).pathname,script=readFileSync(root+'activate-initial-exact-pid.applescript','utf8'),module=readFileSync(root+'activate-initial-exact-pid.mjs','utf8'),focus=readFileSync(root+'scripts/applications/launcher-013-focus.mjs','utf8');
new Function('return ('+activationIdentityExpression(1)+')');
assert(script.includes('(count of argv) is not 5'));assert(script.includes('set expectedTitle to item 5 of argv'));assert(script.includes('set deadline to (current date) + 8'));assert.equal((script.match(/set frontmost of targetProcess to true/g)||[]).length,1);assert.equal((script.match(/perform action "AXRaise"/g)||[]).length,1);assert.equal((script.match(/considering case\n/g)||[]).length,2);
assert(script.includes('exact-title-ambiguous-no-action'));assert(script.includes('exact-title-timeout-no-action'));assert(script.includes('exact-title-changed-no-action'));assert(!script.includes('(count of targetWindows) is not 1'));assert(script.indexOf('set frontmost')>script.indexOf('-- Single action phase'));
for(const identity of ['whose unix id is expectedPid','name of targetProcess','bundle identifier of targetProcess','actualFile is not expectedBundle'])assert(script.includes(identity));
assert(module.includes('pin.executable,mainWindow.title]'));assert(module.includes('timeout:30000'));assert.equal((module.match(/await runFile\(/g)||[]).length,1);assert(focus.includes('mainWindow:record.window'));
const title='[A] CI007 exact test',reply=(activated,reason,totalWindows,titles)=>JSON.stringify({schema:'m12-exact-title-initial-activation-v1',activated,reason,samples:[{totalWindows,matchedWindows:titles.filter(t=>t===title).length,titles}]});
assert.equal(parseActivationReply(reply(true,'exact-title-activated-once',2,[title,'WillYou browser background']),title).activated,true);
assert.equal(parseActivationReply(reply(false,'exact-title-timeout-no-action',0,[]),title).activated,false);
assert.equal(parseActivationReply(reply(false,'exact-title-ambiguous-no-action',2,[title,title]),title).activated,false);
assert.throws(()=>parseActivationReply(reply(true,'exact-title-activated-once',2,[title,title]),title));
assert.throws(()=>parseActivationReply(reply(true,'exact-title-activated-once',1,[title.toLowerCase()]),title));
console.log(JSON.stringify({generatedMainIdentityExpressions:1,protocolPositiveControls:3,protocolNegativeControls:2,readonlyAXWaitSeconds:8,frontmostStatements:1,AXRaiseStatements:1,AppleScriptCompiled:false,AppleScriptExecuted:false,AppNativeExecuted:false}));
