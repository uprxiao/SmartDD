import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
const [directory]=process.argv.slice(2);
if(!directory?.startsWith('/private/tmp/willyou-m12-s1-'))throw Error('Private S1 directory required');
const raw=JSON.parse(await readFile(join(directory,'result.json'),'utf8'));
async function image(step){
  const data=step?.parsed?.data;if(step?.raw?.code!==0||!data?.file)return false;
  const bytes=await readFile(data.file.path);let width=0,height=0,decoded=false;
  if(data.format==='png'){
    const chunks=[];let offset=8,complete=false;
    while(offset+12<=bytes.length){const size=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);if(offset+12+size>bytes.length)break;if(type==='IDAT')chunks.push(bytes.subarray(offset+8,offset+8+size));offset+=12+size;if(type==='IEND'){complete=offset===bytes.length;break;}}
    try{decoded=complete&&inflateSync(Buffer.concat(chunks)).length>0;}catch{}
    width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
  }else if(data.format==='jpeg'){
    let offset=2;
    while(offset+4<bytes.length){if(bytes[offset++]!==255)break;while(bytes[offset]===255)offset++;const marker=bytes[offset++],size=bytes.readUInt16BE(offset);if([192,193,194].includes(marker)){height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;}if(size<2)break;offset+=size;}
    decoded=bytes.readUInt16BE(0)===65496&&bytes.readUInt16BE(bytes.length-2)===65497&&width>0&&height>0;
  }
  return decoded&&width===data.width&&height===data.height&&width/height===1000/700&&bytes.length===data.file.bytes&&createHash('sha256').update(bytes).digest('hex')===data.file.sha256&&data.file.path.startsWith(join(directory,'userData/browser/artifacts',raw.ready.taskId)+'/')&&!Object.hasOwn(data,'base64');
}
const snapshot=raw.formSnapshot,expected=[['button','Action'],['textbox','Input'],['textbox','Editor'],['combobox','Choice'],['checkbox','Check'],['button','Upload']];
const tree=snapshot?.snapshot?.match(/ref=(@[^\]\s,]+)/g)?.map(value=>value.slice(4)).sort()??[];
const declared=snapshot?.refs?.map(item=>item.ref).sort()??[];
const created=raw.steps.find(step=>step.args[1]==='tab'&&step.args[2]==='create')?.parsed?.data;
const T050=snapshot?.browserPageId===created?.pageId&&snapshot?.url===raw.ready?.url&&snapshot?.title==='[I] S1 real native CLI'&&expected.every(([role,name])=>snapshot.refs.some(ref=>ref.role===role&&ref.name===name&&ref.available===true))&&new Set(declared).size===declared.length&&declared.every(ref=>/^@k[0-9a-z]+s\d+e\d+$/.test(ref))&&JSON.stringify(tree)===JSON.stringify(declared);
const sequence=[...(raw.foreground??[]),...(raw.background??[]),...(raw.remounted??[])];
const clicks=sequence.length===16&&sequence.every((row,index)=>row.click.raw.code===0&&row.observed.hits.length===index+1&&row.observed.hits.every(id=>id==='action'));
const latencies=(raw.background??[]).map(row=>row.clickMs).sort((a,b)=>a-b),median=latencies.length===10?(latencies[4]+latencies[5])/2:null;
const images=await Promise.all((raw.background??[]).map(row=>image(row.screenshot)));
const preserved=raw.afterRemount?.value==='preserved-through-parking'&&raw.beforeParking?.value===raw.afterRemount?.value&&raw.beforeParking?.url===raw.afterRemount?.url&&JSON.stringify(raw.beforeParking?.rect)===JSON.stringify(raw.afterRemount?.rect);
const cleanup=raw.hostExit?.code===0&&raw.cleanup?.helpers?.every(helper=>['stopped','absent'].includes(helper.daemonState)&&helper.clientStopped&&helper.socketFilesRemoved);
const checks={fullFormSnapshot:T050,allClicksObserved:clicks,backgroundMedianBelowOneSecond:median!==null&&median<1000,screenshots:images.length===10&&images.every(Boolean),allBackgroundSnapshots:(raw.background??[]).length===10&&raw.background.every(row=>row.snapshot.raw.code===0),remountedStatePreserved:preserved,jpeg:await image(raw.jpeg),cleanup};
const verdict={at:new Date().toISOString(),boundary:'I-level real module/CLI/service lifecycle; placement via host API; no packaged task-switch UI claim',checks,backgroundClickMs:latencies,medianMs:median,cases:{'M12-T050':{passed:T050,layer:'I'},'M12-T054':{passed:checks.screenshots&&checks.jpeg,layer:'I'},'M12-T107':{passed:false,partialI:Object.values(checks).every(Boolean),remaining:'A: real packaged task-switch UI under S6'}},passed:Object.values(checks).every(Boolean)};
await writeFile(join(directory,'adjudication.json'),JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));
