import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile} from 'node:fs/promises';
import ts from 'typescript';
import {waitPassiveInitialFocus} from './initial-focus.mjs';
import {installAppFocusGuard} from './driver-source/scripts/lib/app-focus-guard.mjs';
const root='/private/tmp/willyou-m12-sop-real-static-002/attempt-004',run=await readFile(root+'/run.mjs','utf8'),checks=[];
async function check(id,fn){await fn();checks.push({id,status:'passed'})}
const good={focused:true,visibility:'visible',native:true,owner:{pid:2026,executable:'/synthetic/App021',userData:'/synthetic/userdata'}};
async function simulated(readAt){let t=0;const record={};try{await waitPassiveInitialFocus({record,now:()=>t,delay:async ms=>{t+=ms},read:async()=>readAt(t)});return{passed:true,record}}catch(error){return{passed:false,record,error}}}
await check('No-pointer-genuine-NativeDOM-focus-for3s-enters',async()=>{const x=await simulated(()=>good);assert(x.passed);assert.equal(x.record.actualStableMs,3000);assert.equal(x.record.elapsedMs,3000);assert.equal(x.record.samples.length,13);assert.equal(x.record.pointerRequired,false);assert.equal(x.record.automaticActivations,0);assert.equal(x.record.stableSamples.length,13)});
await check('Native-false-DOM-false-hidden-each-refused',async()=>{for(const state of [{...good,native:false},{...good,focused:false},{...good,visibility:'hidden'}]){const x=await simulated(()=>state);assert(!x.passed);assert.equal(x.record.status,'not-focused-stable');assert.equal(x.record.actualStableMs,0)}});
await check('Less-than3s-observed-before-timeout-refused',async()=>{const x=await simulated(t=>t<297250?{...good,native:false}:good);assert(!x.passed);assert(x.record.actualStableMs<3000)});
await check('Real-observed-focus-loss-resets-full3s-window',async()=>{const x=await simulated(t=>t===1500?{...good,focused:false}:good);assert(x.passed);assert.equal(x.record.resets.length,1);assert.equal(x.record.stableSinceMs,1750);assert.equal(x.record.actualStableMs,3000);assert.equal(x.record.elapsedMs,4750);assert(x.record.stableSamples.every(s=>s.native&&s.focused&&s.visibility==='visible'))});
await check('Original-guard-yield-stays-sticky-and-sends-no-input',async()=>{let focused=false,inputs=0;const app={processId:2026,evaluate:async()=>({focused,visibility:'visible'}),mainEvaluate:async()=>focused,cdp:async()=>{inputs++}},record={};installAppFocusGuard(app,record,{allowOwnedViews:true});await assert.rejects(app.cdp('Input.insertText',{text:'never'}),e=>e.code==='APP_FOCUS_YIELDED');focused=true;await assert.rejects(app.cdp('Input.insertText',{text:'never'}),e=>e.code==='APP_FOCUS_YIELDED');assert.equal(inputs,0);assert.equal(record.focusGuards.length,1);assert(record.focusGuards[0].yieldedAt)});
await writeFile(root+'/focus-check.json',JSON.stringify({at:new Date().toISOString(),status:'passed-pure-controls',checks,Native:0,App:0,models:0,credentialReads:0,formalWholeCaseCount:0},null,2)+'\n');console.log(JSON.stringify({status:'passed-pure-controls',checks:checks.length,Native:0,models:0}));
