import assert from'node:assert/strict';
import{join}from'node:path';

// Shared read-only observation on original A/P version-row publication nodes.
export async function observePublicationRow({app,result,root,context,state,version='0.9.0'}){
 const label='版本 v'+version+' 发布阶段',selector='[aria-label='+JSON.stringify(label)+']';
 const row=await app.evaluate(`(()=>{const stage=document.querySelector(${JSON.stringify(selector)}),row=stage?.closest('.m10-version-row');if(!row)return null;return{text:row.innerText,stage:stage.innerText,cleanup:[...row.querySelectorAll('button')].some(e=>e.textContent==='清理版本 v'+${JSON.stringify(version)}),horizontalOverflow:row.scrollWidth>row.clientWidth+1}})()`);assert(row&&!row.horizontalOverflow,'SY publication row stays within horizontal bounds');
 const titles={staged:'准备未完成',verified:'已校验，发布未完成','recovery-required':'恢复待核查',ready:'已发布'};assert(row.stage.includes('版本阶段：'+titles[state]));assert.equal(row.cleanup,state==='ready');
 if(['staged','verified'].includes(state)){assert(row.text.includes('最终版本目录尚未就绪'));assert(row.text.includes('最终目录尚未发布，准备阶段不作为可用版本。'));}
 const record={context,state,version,row,nodes:[],boundary:'Same semantic publication row;P metadata is fixed synthetic, A native registry. No data/DOM/style assignment.'};(result.publicationVisual??={contexts:[]}).contexts.push(record);
 const props=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor','paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','display','borderTopWidth','borderTopStyle','borderTopColor','borderRadius','opacity','overflowWrap'];
 for(let i=1;i<=4;i++){
  const node=selector+'>p:nth-child('+i+')';await app.evaluate(`document.querySelector(${JSON.stringify(node)}).scrollIntoView({block:'center',behavior:'instant'});true`);await app.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const data=await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(node)}),r=e.getBoundingClientRect(),s=getComputedStyle(e);return{text:e.textContent,visible:r.top>=0&&r.bottom<=innerHeight,rect:{x:r.x,y:r.y,width:r.width,height:r.height},style:Object.fromEntries(${JSON.stringify(props)}.map(k=>[k,s[k]]))}})()`);assert(data.visible,'SY each publication sentence is visibly reachable');record.nodes.push(data);
 }
 record.viewport=await app.evaluate('({width:innerWidth,height:innerHeight,theme:document.documentElement.dataset.theme??(document.documentElement.classList.contains("ydark")?"dark":"light")})');
 const file='sy-'+context+'-'+state+'.png';await app.screenshot(join(root,file));record.file=file;record.passed=true;
}
