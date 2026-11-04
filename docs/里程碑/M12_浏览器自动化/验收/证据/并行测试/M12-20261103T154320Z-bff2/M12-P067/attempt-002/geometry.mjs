export async function waitStableGeometry({read,frame,focus,timeoutMs=8000,samples=[]}){
 const deadline=Date.now()+timeoutMs;let previous=null,stable=0;
 while(Date.now()<deadline){
  await focus();const current=await read();samples.push({atMs:Date.now(),value:current});
  if(current?.available&&current.activeAnimations===0){const same=previous&&previous.x===current.x&&previous.y===current.y;stable=same?stable+1:1;previous=current;if(stable>=3)return{x:current.x,y:current.y};}
  else{previous=null;stable=0}
  await frame();
 }
 throw Error('Target visibility/refresh/animation/geometry did not settle within '+timeoutMs+'ms; no click sent');
}
