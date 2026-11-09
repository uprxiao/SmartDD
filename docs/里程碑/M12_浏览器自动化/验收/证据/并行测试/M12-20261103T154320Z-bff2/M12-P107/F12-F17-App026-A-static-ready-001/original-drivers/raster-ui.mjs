import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {openFileAcceptanceApp} from './file-acceptance-ui.mjs';
import {pause} from '../lib/electron-harness.mjs';
import {pngFirstPixel} from './png-first-pixel.mjs';
const executable=process.env.WILLYOU_FILES_APP,projectPath=process.env.SMARTDD_RASTER_PROJECT;assert(executable&&projectPath);
const fixtureRoot=dirname(projectPath),scratch=await mkdtemp(join(fixtureRoot,'app-run-')),oracle=JSON.parse(await readFile(join(fixtureRoot,'fixtures.json'),'utf8')),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fingerprints=async()=>Object.fromEntries(await Promise.all(oracle.cases.map(async({name})=>{const p=join(projectPath,name),s=await stat(p,{bigint:true});return[name,{sha256:sha(await readFile(p)),inode:String(s.ino),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}]})));
const resources=resolve(dirname(executable),'../Resources'),result={caseId:'M9-T-F12',at:new Date().toISOString(),app:executable,asarSha256:sha(await readFile(join(resources,'app.asar'))),projectPath,before:await fingerprints(),checks:[],status:'running'};let app,stage='initial';
try{
  app=await openFileAcceptanceApp({executable,projectPath,userData:join(scratch,'userdata'),name:'All raster formats acceptance'});
  for(const item of oracle.cases){
    stage=item.name;await app.open(item.name);const check={file:item.name,mime:item.mime};
    if(item.decodeFailure){await app.waitFor("document.querySelector('.fw-ordinary-image [role=alert]')?.textContent.includes('无法解码此图像文件')");assert(await app.evaluate("Boolean([...document.querySelectorAll('.fw-ordinary-image button')].find(e=>e.textContent==='重新加载'))"));check.explicitDecodeFailure=true;check.retryEntry=true;}
    else{
      await app.waitFor(`document.querySelector('.fw-ordinary-image img')?.naturalWidth===${item.width}`);assert.equal(await app.evaluate("document.querySelector('.fw-ordinary-image img').naturalHeight"),item.height);check.decodedSize=[item.width,item.height];
      if(item.animation){
        // Canvas drawImage is required to use an animated image's default/first
        // frame. Inspect the actual compositor instead (WHATWG canvas spec).
        const colors=[],clip=await app.evaluate("(()=>{const r=document.querySelector('.fw-ordinary-image img').getBoundingClientRect();return{x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2),width:1,height:1,scale:1}})()");
        for(let n=0;n<16;n++){const {data}=await app.cdp('Page.captureScreenshot',{format:'png',clip}),bytes=Buffer.from(data,'base64');colors.push(pngFirstPixel(bytes));await writeFile(join(scratch,`animation-frame-${n}.png`),bytes);await pause(75)}
        check.animation={method:'Actual compositor screenshots, not Canvas drawImage',actualColors:colors};result.lastAnimation=check.animation;
        const red=colors.some(c=>c[0]>150&&c[1]<90),green=colors.some(c=>c[1]>130&&c[0]<90);assert(red&&green,'Actual GIF displayed no animation');check.animation.redAndGreenFramesObserved=true;
      }
      if(item.transparent){const alpha=await app.evaluate("(()=>{const i=document.querySelector('.fw-ordinary-image img'),c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);return[x.getImageData(2,2,1,1).data[3],x.getImageData(30,2,1,1).data[3]]})()");assert.deepEqual(alpha,[0,255]);check.alpha=alpha;}
    }
    assert(!await app.evaluate("Boolean(document.querySelector('.cm-editor'))"));await app.screenshot(join(scratch,item.name+'.png'));result.checks.push(check);
  }
  result.after=await fingerprints();assert.deepEqual(result.after,result.before);assert.deepEqual(app.rendererErrors,[]);assert.equal((await app.invoke('tasks.list')).length,0);result.status='passed';
}catch(error){result.status='failed';result.error=String(error);result.failedStage=stage;process.exitCode=1;if(app){try{result.failureDom=await app.evaluate('document.body.innerText');await app.screenshot(join(scratch,'failure.png'));}catch{}}}
finally{if(app){await writeFile(join(scratch,'electron.log'),app.logs());await app.close();}result.finishedAt=new Date().toISOString();await writeFile(join(scratch,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,checks:result.checks.length,failedStage:result.failedStage,error:result.error,artifacts:scratch}));}
