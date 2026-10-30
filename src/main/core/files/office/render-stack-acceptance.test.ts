import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {describe,it,expect} from 'vitest';
import {NativeFileBroker,type BrokerOptions} from '../native-broker';
import {FileHeavyJobs} from '../heavy-jobs';
import {LibreOfficeEngine} from './libreoffice-engine';
const run=promisify(execFile),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
// Explicit diagnostic only. The normal packaged broker, policy and 20/30s
// native/transport deadlines are intact. Sampling overhead is not performance
// evidence. The real render must still succeed; a timeout remains a red test.
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_RENDER_STACK_APP||!process.env.SMARTDD_RENDER_STACK_SOURCE||!process.env.SMARTDD_RENDER_STACK_EVIDENCE)('W26 exact owned renderer stack diagnosis',()=>{
  it('renders the original Office file while sampling only its newly issued native child',async()=>{
    const app=process.env.SMARTDD_RENDER_STACK_APP!,source=process.env.SMARTDD_RENDER_STACK_SOURCE!,out=process.env.SMARTDD_RENDER_STACK_EVIDENCE!;
    mkdirSync(out,{recursive:true});const base=realpathSync(mkdtempSync('/private/tmp/willyou-render-stack-')),userdata=join(base,'userdata');mkdirSync(userdata);
    const resources=join(app,'Contents/Resources'),runtime=join(resources,'native/libreoffice'),executable=join(runtime,'LibreOffice.app/Contents/MacOS/soffice'),bytes=readFileSync(source),before=statSync(source,{bigint:true}),events:unknown[]=[],samples:Promise<void>[]=[];
    const evidence:Record<string,unknown>={at:new Date().toISOString(),caseId:'M9-T-W26',layer:'I diagnostic,not GUI A',app,source,sourceHash:sha(bytes),nativeHash:sha(readFileSync(join(resources,'native/willyou-files'))),events,boundary:'Original packaged native IO and LibreOffice renderer,private engine workspace. Only newly owned broker child with verified direct ppid and exact vendor executable is sampled. No process injection,policy/deadline/result change,system unlock or daily process inspection.'};
    class ObservedBroker extends NativeFileBroker{
      override request<T>(input:Record<string,unknown>,options:BrokerOptions={}):Promise<T>{
        events.push({phase:'broker-request',operation:input.operation,at:new Date().toISOString()});writeFileSync(join(out,'progress.json'),JSON.stringify(evidence,null,2)+'\n');
        if(input.operation==='office-render'&&process.env.SMARTDD_RENDER_JOB_PREFS==='ignore-state'){
          const job=(input.job as {path:string}).path,prefs=join(job,'home/Library/Preferences');mkdirSync(prefs,{recursive:true,mode:0o700});
          writeFileSync(join(prefs,'org.libreoffice.script.plist'),'<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>ApplePersistenceIgnoreState</key><true/></dict></plist>',{mode:0o600});
          events.push({phase:'private-job-preference',path:join(prefs,'org.libreoffice.script.plist'),value:{ApplePersistenceIgnoreState:true},boundary:'Private diagnostic input,not original production job. No global/user preferences changed.'});
        }
        const pending=super.request<T>(input,options);if(input.operation!=='office-render'||process.env.SMARTDD_RENDER_STACK_MODE==='none')return pending;
        let busy=false,sampled=false;const started=Date.now();
        const observe=async()=>{
          if(busy||sampled)return;busy=true;
          try{
            const parents=[...(this as unknown as {children:Set<ChildProcessWithoutNullStreams>}).children].map(c=>c.pid).filter((pid):pid is number=>!!pid);
            for(const parent of parents){
              let listed='';try{listed=(await run('/usr/bin/pgrep',['-P',String(parent)],{timeout:1000})).stdout;}catch{continue;}
              for(const pid of listed.trim().split(/\s+/).map(Number).filter(n=>n>0)){
                let actual='';try{actual=(await run('/bin/ps',['-p',String(pid),'-o','ppid=,comm='],{timeout:1000})).stdout.trim();}catch{continue;}
                const match=/^(\d+)\s+(.+)$/.exec(actual);if(!match||Number(match[1])!==parent||match[2]!==executable)continue;
                sampled=true;events.push({phase:'sample-start',ms:Date.now()-started,parent,pid,executable:match[2],job:input.job});
                const sample=(async()=>{try{
                  // The initial diagnostic only captured ordinary AppKit
                  // startup. Sample inside the original 20s deadline instead.
                  await new Promise(done=>setTimeout(done,9000));
                  const live=(await run('/bin/ps',['-p',String(pid),'-o','ppid=,comm='],{timeout:1000})).stdout.trim();expect(live).toBe(actual);
                  events.push({phase:'sample-live-revalidated',ms:Date.now()-started,parent,pid});
                  const result=await run('/usr/bin/sample',[String(pid),'2','1','-file',join(out,'renderer-stack.txt')],{timeout:8000,maxBuffer:1024*1024});events.push({phase:'sample-end',ms:Date.now()-started,pid,stdout:result.stdout,stderr:result.stderr});
                  if(process.env.SMARTDD_RENDER_STACK_DENIALS==='1'){
                    // Exact newly owned child only. The private diagnostic
                    // broker reports existing denials; no allow rule changes.
                    const predicate=`processID == ${pid} OR ((process == "sandboxd" OR process == "kernel") AND eventMessage CONTAINS "soffice(${pid})")`;
                    try{const log=await run('/usr/bin/log',['show','--style','json','--last','20s','--predicate',predicate],{timeout:5000,maxBuffer:2*1024*1024});writeFileSync(join(out,'owned-renderer-unified.json'),log.stdout);events.push({phase:'owned-unified-log',pid,predicate,stderr:log.stderr});}
                    catch(error){events.push({phase:'owned-unified-log-error',pid,error:String(error)});}
                  }
                }catch(error){events.push({phase:'sample-error',pid,error:String(error)});}})();samples.push(sample);return;
              }
            }
          }finally{busy=false;}
        };
        const timer=setInterval(()=>{void observe();},100);void observe();
        return pending.then(value=>{events.push({phase:'original-render-success',ms:Date.now()-started});return value;},error=>{events.push({phase:'original-render-error',ms:Date.now()-started,error:String(error)});throw error;}).finally(()=>clearInterval(timer));
      }
    }
    const broker=new ObservedBroker(process.env.SMARTDD_RENDER_STACK_BROKER??join(resources,'native/willyou-files')),engine=new LibreOfficeEngine(broker,{directory:runtime,userData:userdata,packagePath:app},new FileHeavyJobs());evidence.actualBroker=broker.executable;evidence.actualBrokerHash=sha(readFileSync(broker.executable));evidence.jobPreference=process.env.SMARTDD_RENDER_JOB_PREFS??'original';
    evidence.samplingMode=process.env.SMARTDD_RENDER_STACK_MODE??'late';writeFileSync(join(out,'progress.json'),JSON.stringify(evidence,null,2)+'\n');
    try{
      const format=source.endsWith('.pptx')?'pptx':'docx';evidence.format=format;
      const result=await engine.render(bytes,format,new AbortController().signal);writeFileSync(join(out,'actual.pdf'),result.bytes);evidence.result={hash:result.hash,bytes:result.bytes.length,pages:result.pages,elapsedMs:result.elapsedMs,peakRssBytes:result.peakRssBytes,diagnostic:result.diagnostic};expect(result.pages).toBe(2);expect(result.hash).toBe(sha(result.bytes));
      if(process.env.SMARTDD_RENDER_EXPECT_IGNORE_STATE==='1'){
        // Explicit macOS26 diagnostic: inspect actual unmodified AppKit output,
        // not just the broker's argv text. This is not a cross-OS logging API.
        expect(result.diagnostic).toContain('ApplePersistenceIgnoreState: Existing state will not be touched.');
        expect(result.diagnostic).toContain('New state will be written to <文档快照>/tmp/org.libreoffice.script.savedState');
        evidence.privateAppKitStateConfirmed=true;
      }
    }catch(error){evidence.error=String(error);throw error;}
    finally{
      await Promise.allSettled(samples);engine.dispose();broker.dispose();const after=statSync(source,{bigint:true});evidence.sourceUnchanged=sha(readFileSync(source))===sha(bytes)&&before.ino===after.ino&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs;evidence.finishedAt=new Date().toISOString();writeFileSync(join(out,'result.json'),JSON.stringify(evidence,null,2)+'\n');rmSync(base,{recursive:true,force:true});expect(evidence.sourceUnchanged).toBe(true);
    }
  },75000);
});
