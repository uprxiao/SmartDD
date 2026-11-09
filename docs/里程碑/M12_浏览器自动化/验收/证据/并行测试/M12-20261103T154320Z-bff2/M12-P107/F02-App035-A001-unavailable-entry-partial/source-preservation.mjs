import assert from'node:assert/strict';
export function assertSourcePreserved(before,after,permissionRestored){
 assert.deepEqual(Object.keys(after).sort(),Object.keys(before).sort());
 for(const[name,value]of Object.entries(before)){
  const next=after[name];assert(next,name);
  if(Object.hasOwn(permissionRestored,name)){
   const restored=permissionRestored[name];for(const field of Object.keys(value).filter(x=>x!=='ctimeNs')){assert.equal(next[field],value[field],name+':'+field);assert.equal(restored[field],value[field],name+':restored:'+field);}assert.equal(next.ctimeNs,restored.ctimeNs,name+': final ctime must be actual restored checkpoint');
  }else assert.deepEqual(next,value,name);
 }
}
