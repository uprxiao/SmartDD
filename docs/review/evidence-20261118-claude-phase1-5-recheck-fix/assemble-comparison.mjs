import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { scenes, sizes } from './state-fixture.mjs';

const root=process.argv[2], output=join(root,'side-by-side');
mkdirSync(output,{recursive:true});
const app=JSON.parse(readFileSync(join(root,'app-verified','app.json'),'utf8'));
const prototype=JSON.parse(readFileSync(join(root,'prototype','prototype.json'),'utf8'));
assert.deepEqual(app.failures,[]);
assert.deepEqual(app.rendererErrors,[]);
assert.deepEqual(prototype.issues,[]);
assert.equal(app.exit?.code,0);
assert(!app.error&&!app.exitError);
const names=[...scenes.map(s=>s.id),'g1-delete','g5-settings','g5-readonly'];
const evidence=[];
for(const [view,,width,height] of sizes)for(const name of names){
 const before=prototype.results.find(result=>result.view===view&&result.name===name);
 const actual=app.results.find(result=>result.view===view&&result.name===name);
 for(const result of [before,actual])assert.deepEqual([result?.width,result?.height,result?.overflow],[width,height,false],view+' '+name);
 if(name==='g1-delete'){
  assert.equal(actual.panelWidth,490);
  assert.equal(actual.overlapsMenu,false);
 }
 const file=`${view}-${name}.png`;
 execFileSync('magick',[join(root,'prototype',file),join(root,'app-verified',file),'+append',join(output,file)]);
 evidence.push({view,name,comparison:'side-by-side/'+file});
}
writeFileSync(join(root,'manifest.json'),JSON.stringify({sceneCount:names.length,pairs:evidence.length,evidence},null,2)+'\n');
console.log(evidence.length+' paired screenshots');
