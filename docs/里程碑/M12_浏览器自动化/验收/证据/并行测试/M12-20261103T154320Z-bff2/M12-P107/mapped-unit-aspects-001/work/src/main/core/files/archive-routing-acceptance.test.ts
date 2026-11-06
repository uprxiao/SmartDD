import {afterAll,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {classifyFile,FILE_ARCHIVE_EXTENSIONS} from '@shared/file-classification';
import {FileService} from './file-service';
import {FileRootsService} from './roots';
import {FileRecoveryStore} from './recovery-store';
import {NativeFileBroker} from './native-broker';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const observations:unknown[]=[],sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterAll(()=>{if(process.env.SMARTDD_ARCHIVE_EVIDENCE)writeFileSync(process.env.SMARTDD_ARCHIVE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-F26',level:'U/I fixed minimum-container fixture oracle + actual native service, no extraction',observations},null,2)+'\n')});
describe.skipIf(!process.env.SMARTDD_ARCHIVE_PROJECT||!process.env.SMARTDD_FILES_NATIVE_PATH)('Archive dispatch native integration',()=>{
 it('preserves all 27 archive containers alongside higher-priority Office/unsupported routing without changing bytes',async()=>{
  const project=process.env.SMARTDD_ARCHIVE_PROJECT!,oracle=JSON.parse(readFileSync(join(project,'../fixtures.json'),'utf8')) as {cases:{name:string;kind:string;sha256:string;extension:string;damaged?:boolean;traversalPayload?:boolean}[]};
  expect(oracle.cases.filter(c=>!c.damaged&&!c.traversalPayload).map(c=>c.extension)).toEqual([...FILE_ARCHIVE_EXTENSIONS]);const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-archive-native-'))),broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'archives',path:project,label:'Synthetic archives'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,base,resolver));
  try{const root=(await files.openScope('archives',{kind:'project',projectId:'archives'})).roots[0];for(const item of oracle.cases){const original=readFileSync(join(project,item.name)),expected={kind:item.kind,container:'archive'};expect(classifyFile(item.name,original)).toMatchObject(expected);expect(classifyFile(item.name.toUpperCase(),original)).toMatchObject(expected);const document=await files.open('archives',{lease:root.lease,generation:root.generation,relativePath:item.name});expect(document.content).toMatchObject(expected);const read=await files.read('archives',document.ref);expect(sha(Buffer.from(read.base64,'base64'))).toBe(item.sha256);expect(readFileSync(join(project,item.name))).toEqual(original);observations.push({file:item.name,content:document.content,sourceSha256:item.sha256});files.closeDocument('archives',document.ref)}}finally{files.closeOwner('archives');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true})}
 });
});
