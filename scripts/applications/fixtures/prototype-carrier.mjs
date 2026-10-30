import assert from 'node:assert/strict';

// Private test cleanup only. The independent prototype does not host the
// packaged renderer's file-close protocol; never forge a close acknowledgement.
export async function capturePrototypeCarrier({app,userData}){
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)}||E.BrowserWindow.getAllWindows().length!==1)throw Error('Only this private prototype carrier');return true})()`);
 const native=await app.evaluate("({url:location.href,hasBridge:!!window.electronAPI,hasNativeView:!!document.querySelector('[data-testid=nav-settings]')})");
 assert(native.hasBridge&&native.hasNativeView&&native.url.startsWith('file:'),'Capture the original packaged renderer before prototype navigation');
 return{nativeUrl:native.url,userData,boundary:'Cleanup identity only, not an accepted product navigation or business state.'};
}
export async function restorePrototypeCarrier({app,carrier,prototypeOrigin}){
 const before=await app.evaluate("({url:location.href,hasBridge:!!window.electronAPI,hasNativeView:!!document.querySelector('[data-testid=nav-settings]'),hasPrototype:!!document.querySelector('.m10-previewbar')})");
 const current=new URL(before.url);assert(current.protocol==='http:'&&current.hostname==='127.0.0.1'&&current.origin===prototypeOrigin,'Only this private loopback prototype may be replaced for cleanup');
 assert(!before.hasNativeView&&before.hasPrototype,'Only the independent prototype page may be restored for cleanup');
 await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(carrier.userData)}||E.BrowserWindow.getAllWindows().length!==1)throw Error('Original private carrier identity changed');return true})()`);
 await app.cdp('Page.navigate',{url:carrier.nativeUrl});
 await app.waitFor('location.href==='+JSON.stringify(carrier.nativeUrl)+"&&!!window.electronAPI&&!!document.querySelector('[data-testid=nav-settings]')",15000,{navigation:true});
 await app.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>{document.title='A · 测试清理 · 已恢复原生载体';r(true)})))");
 return{from:before.url,to:carrier.nativeUrl,restoredOriginalRenderer:true,classification:'Prototype test cleanup via original native renderer; not product normal-exit acceptance',syntheticCloseReplies:0};
}
