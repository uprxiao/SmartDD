import assert from 'node:assert/strict';
export function verifyNativeActualReceipt(v,h,mode){
 assert(v&&v.operator==='native-automation'&&v.done===true&&v.guiReleased===true&&v.actualNativeAction===true);
 assert.equal(v.pid,h.pid);assert.equal(v.executable,h.exe);assert.equal(v.action,h.action);
 assert.equal(v.title,h.windowTitle??h.title);assert.equal(v.rootId,h.windowId??h.rootId);
 assert(v.nativeTool==='CUA-exact-app' || v.nativeTool==='macOS-AX-exact-pid');
 assert(Array.isArray(v.focusSamples)&&v.focusSamples.length>=2);
 assert(v.focusSamples.every(s=>s.pid===h.pid&&s.exe===h.exe&&s.focusConfirmed===true&&Number.isFinite(s.at)));
 assert(v.focusSamples.at(-1).at-v.focusSamples[0].at>=3000);
 assert(v.actualControl&&v.actualControl.nativeRole==='button'&&typeof v.actualControl.label==='string'&&v.actualControl.label.length>0);
 if(mode==='file'){assert.equal(v.handoffId,h.handoffId);assert.equal(v.sequence,h.sequence);assert(v.actualControl.label=== (h.expectedCancel?'取消':'保存')||v.actualControl.label===(h.expectedCancel?'Cancel':'Save'));if(!h.expectedCancel)assert.equal(v.selectedPath,h.path);}
 else {assert.equal(v.nonce,h.nonce);assert(v.nativeQuitEntry==='real-app-menu-or-command-q');assert(v.actualControl.label===(h.action==='cancel'?'取消':'退出')||v.actualControl.label===(h.action==='cancel'?'Cancel':'Quit'));}
 // End-of-click may intrinsically close the process or sheet; original independent App result remains mandatory.
 assert(typeof v.actualDialogObserved==='string'&&v.actualDialogObserved.includes(mode==='file'?'导出项目':'Agent'));
 return v;
}
