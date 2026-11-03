export const s3FixtureHtml=`<!doctype html><meta charset="utf-8"><title>S3 native CLI fixture</title>
<style>@page{size:A5}body{background:#28a080;margin:20px}#drag-from,#drag-to{width:100px;height:60px;background:white;margin:12px}#bottom{margin-top:2800px}</style>
<form onsubmit="event.preventDefault()"><button type="button" id="action">Action</button><input id="field" aria-label="Input">
<div contenteditable role="textbox" aria-label="Editor"></div><select id="choice" aria-label="Choice"><option value="A">Alpha</option><option value="B">Beta</option></select>
<input id="check" type="checkbox" aria-label="Check"><input id="upload" type="file" aria-label="Upload"><span id="hidden" hidden>hidden</span></form>
<div id="drag-from" draggable="true" role="button" aria-label="Drag source">source</div><div id="drag-to" role="button" aria-label="Drop target">target</div>
<button id="bottom">Bottom</button><script>
window.s3Events=[];window.s3Hits=0;window.s3Drops=0;window.s3Keys=[];
for(const type of ['click','dblclick','mouseover','dragstart','dragover','drop','input','change','mousemove','mousedown','mouseup','wheel','scroll'])window.addEventListener(type,event=>{window.s3Events.push({type,id:event.target.id??'',x:event.clientX??null,y:event.clientY??null,button:event.button??null,dx:event.deltaX??null,dy:event.deltaY??null});},true);
window.addEventListener('keydown',event=>window.s3Keys.push(event.key),true);
document.getElementById('action').addEventListener('click',()=>window.s3Hits++);
document.getElementById('drag-from').addEventListener('dragstart',event=>event.dataTransfer.setData('text/plain','S3 drag'));
document.getElementById('drag-to').addEventListener('dragover',event=>event.preventDefault());
document.getElementById('drag-to').addEventListener('drop',event=>{event.preventDefault();if(event.dataTransfer.getData('text/plain')==='S3 drag'){window.s3Drops++;event.currentTarget.textContent='dropped';}});
window.s3State=()=>({url:location.href,title:document.title,value:document.getElementById('field').value,editor:document.querySelector('[contenteditable]').textContent,choice:document.getElementById('choice').value,checked:document.getElementById('check').checked,hits:window.s3Hits,drops:window.s3Drops,keys:window.s3Keys.slice(),events:window.s3Events.slice(),scrollY,local:localStorage.getItem('s3-key'),session:sessionStorage.getItem('s3-key')});
</script>`;
