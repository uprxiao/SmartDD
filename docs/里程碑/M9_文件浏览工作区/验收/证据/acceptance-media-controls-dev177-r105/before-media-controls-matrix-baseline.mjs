// Shared P/A matrix, initial historical baseline mode is observation only.
export async function runMediaControls(app,{prototype,theme,record}){
 await app.click('[aria-label="媒体菜单"]');
 if(!prototype)await app.waitFor('document.querySelector("[role=menu]")?.contains(document.activeElement)');
 const state=await app.evaluate(`({radios:[...document.querySelectorAll('[role=menuitemradio]')].map(e=>({name:e.textContent,checked:e.getAttribute('aria-checked')})),select:[...document.querySelectorAll('[aria-label="播放速度"] option')].map(e=>e.textContent),nativeVideo:!!document.querySelector('video'),text:document.querySelector('.fw-media,.fw-media-view').innerText})`);
 await record('baseline',theme,'original media speed/volume controls before verification',{state});
}
