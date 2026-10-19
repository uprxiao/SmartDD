import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function pollJSON(path){const end=Date.now()+12000;while(Date.now()<end){try{return JSON.parse(await readFile(path,'utf8'));}catch{}await delay(10);}throw Error('Own writer did not produce '+path);}
export async function prepareSaveWriters(base,target,specifications){
 base=await realpath(base);assert(base.startsWith('/private/tmp/willyou-save-race-'));assert((await realpath(target)).startsWith(join(base,'project')+'/'));
 const directory=await mkdtemp(join(base,'writers-')),gate=join(directory,'release'),writers=[];
 try{
  for(let index=0;index<specifications.length;index++){
   const specification=specifications[index],ready=join(directory,index+'-ready.json'),result=join(directory,index+'-result.json'),path=join(directory,index+'-config.json'),config={base,target,gate,ready,result,mode:specification.mode,base64:Buffer.from(specification.text).toString('base64')};await writeFile(path,JSON.stringify(config));
   const child=spawn('/usr/bin/python3',[resolve('scripts/files/save-race-writer.py'),path],{stdio:'ignore'}),writer={configPath:path,config,child,pid:child.pid,closed:false};writer.exit=new Promise(done=>{child.once('error',error=>{writer.closed=true;writer.closeResult={error:String(error)};done(writer.closeResult)});child.once('close',(code,signal)=>{writer.closed=true;writer.closeResult={code,signal};done(writer.closeResult)})});writers.push(writer);writer.ready=await pollJSON(ready);assert.equal(writer.ready.pid,child.pid);assert(!writer.ready.error);
  }
 }catch(error){for(const writer of writers)if(!writer.closed)writer.child.kill('SIGTERM');await Promise.all(writers.map(x=>x.exit));throw error;}
 const evidence=()=>({directory,gate,writers:writers.map(x=>({pid:x.pid,configPath:x.configPath,mode:x.config.mode,ready:x.ready,result:x.result,closed:x.closed,exit:x.closeResult}))});
 return{
  release:()=>writeFile(gate,'release\n'),
  finishSync:()=>{writeFileSync(gate,'release\n');const code='import json,pathlib,sys,time; paths=[pathlib.Path(p) for p in sys.argv[1:]]; deadline=time.monotonic()+10\nwhile not all(p.exists() for p in paths):\n if time.monotonic()>deadline: raise TimeoutError("Own writers did not finish")\n time.sleep(.005)\nprint(json.dumps([json.loads(p.read_text()) for p in paths]))';return JSON.parse(execFileSync('/usr/bin/python3',['-c',code,...writers.map(x=>x.config.result)],{encoding:'utf8'}));},
  wait:async()=>{for(const writer of writers){writer.result=await pollJSON(writer.config.result);assert(!writer.result.error,writer.result.error);assert.equal(writer.result.pid,writer.pid);const exit=await writer.exit;assert.equal(exit.code,0);assert.equal(exit.signal,null);}return evidence();},
  evidence,
  cancel:async()=>{for(const writer of writers)if(!writer.closed)writer.child.kill('SIGTERM');await Promise.all(writers.map(x=>x.exit));}
 };
}
