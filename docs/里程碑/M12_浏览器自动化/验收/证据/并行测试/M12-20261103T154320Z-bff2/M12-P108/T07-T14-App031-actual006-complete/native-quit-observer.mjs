import assert from 'node:assert/strict';
export function verifyNativeConfirmation(value,expected){
 assert.equal(value.schema,'t131-native-confirmation-v1');assert(Number.isFinite(Date.parse(value.at)));
 assert.equal(value.pid,expected.pid);assert.equal(value.executable,expected.executable);assert.equal(value.bundle,expected.bundle);assert.equal(value.windowTitle,expected.title);
 assert.equal(value.accessibilityTrusted,true);assert.equal(value.activated,false);assert.equal(value.syntheticPointerEvents,false);assert.equal(value.signalsSent,false);
 assert.equal(value.quitItemTitle,'退出 WillYou');assert.equal(value.quitItemEnabled,true);assert.equal(value.confirmationDialogAppeared,true);assert.equal(value.confirmationButton,'退出');assert.equal(value.confirmationPressResult,0);
 assert(value.confirmationDialogText.includes('有 1 个任务正在运行')&&value.confirmationDialogText.includes('WillYou'));
 return value;
}
export async function observeConfirmedNativeQuit({app,helperPromise,readConfirmation,readFinal,poll,expected,record,persist}){
 let settled;const outcome=helperPromise.then(value=>(settled={ok:true,value}),error=>(settled={ok:false,error}));
 try{
 const confirmation=await poll(async()=>{const v=await readConfirmation();if(v)return verifyNativeConfirmation(v,expected);if(settled&&!settled.ok)throw settled.error;if(settled)throw Error('Native helper ended without strict confirmation receipt');return null},25000);
 record.confirmation=confirmation;record.confirmationObservedAt=new Date().toISOString();await persist();
 // waitForExit releases only this harness's main inspector, without input, App.quit, or a signal.
 record.inspectorReleaseRequestedAt=new Date().toISOString();const exitPromise=app.waitForExit(60000);await persist();
 const exit=await exitPromise;record.sameChildExit=exit;record.sameChildObserved=app.observedProcess();await persist();
 assert.equal(exit.pid,expected.pid);assert.equal(exit.code,0);assert.equal(exit.signal,null);assert.deepEqual(record.sameChildObserved.signals,[]);
 const result=await outcome;if(!result.ok)throw result.error;const final=await readFinal();record.finalAXReceipt=final;await persist();
 assert(final.ok&&final.pid===expected.pid&&final.processExited&&final.accessibilityTrusted&&final.confirmationDialogAppeared&&final.confirmationPressResult===0&&final.activated===false&&final.syntheticPointerEvents===false&&final.signalsSent===false);
 return{final,exit,helperStdoutBytes:Buffer.byteLength(result.value.stdout)};
 }finally{const completed=await outcome;record.helperCompleted={ok:completed.ok,exitCode:completed.ok?0:completed.error.code??null,signal:completed.ok?null:completed.error.signal??null};await persist();}
}
