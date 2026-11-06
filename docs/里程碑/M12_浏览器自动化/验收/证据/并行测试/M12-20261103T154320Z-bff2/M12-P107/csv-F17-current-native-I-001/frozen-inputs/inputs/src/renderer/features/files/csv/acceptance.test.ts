import {afterAll,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,realpathSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {decodeFileText} from '@shared/file-text';
import {readFileResource} from '../resource';
import {CsvModel} from './model';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const observations:unknown[]=[],sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
afterAll(()=>{if(process.env.SMARTDD_CSV_ACCEPTANCE_EVIDENCE)writeFileSync(process.env.SMARTDD_CSV_ACCEPTANCE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-F17',level:'I, production native FileService + revision checked resource reader + decoder + CsvModel; no clipboard/source writes',observations},null,2)+'\n')});
describe.skipIf(!process.env.SMARTDD_CSV_ACCEPTANCE_PROJECT||!process.env.SMARTDD_FILES_NATIVE_PATH)('CSV/TSV actual source parsing',()=>{
  it('preserves exact original bytes and parses quoted delimiters/newlines/Unicode/empty/formula strings without coercion',async()=>{
    const project=process.env.SMARTDD_CSV_ACCEPTANCE_PROJECT!,oracle=JSON.parse(readFileSync(join(project,'../fixtures.json'),'utf8')) as {cases:{name:string;source:string;delimiter:','|'\t';rows?:string[][];invalid?:boolean;bom?:boolean}[]};
    const base=realpathSync(mkdtempSync(join(tmpdir(),'willyou-csv-native-'))),broker=new NativeFileBroker(process.env.SMARTDD_FILES_NATIVE_PATH!),resolver={sources:()=>[{kind:'project-directory' as const,id:'root',projectId:'csv',path:project,label:'Synthetic CSV/TSV'}]},files=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,base,resolver));
    try{
      const root=(await files.openScope('csv',{kind:'project',projectId:'csv'})).roots[0];
      for(const item of oracle.cases){const path=join(project,item.name),original=readFileSync(path),before=statSync(path,{bigint:true}),document=await files.open('csv',{lease:root.lease,generation:root.generation,relativePath:item.name});expect(document.content?.kind).toBe('text');
        const bytes=await readFileResource(document,{chunk:(ref,offset,length,hash,id)=>files.chunk('csv',ref,offset,length,hash,id)},new AbortController().signal);expect(Buffer.from(bytes)).toEqual(original);expect(new TextDecoder().decode(bytes)).toBe(item.source.replace(/^\uFEFF/,''));const decoded=decodeFileText(bytes);expect(decoded.kind).toBe('text');if(decoded.kind!=='text')throw Error('Expected text');expect(decoded.bom).toBe(!!item.bom);
        if(item.invalid)expect(()=>new CsvModel(decoded.raw,item.delimiter)).toThrow('引号未闭合');else{const model=new CsvModel(decoded.raw,item.delimiter),expected=item.rows!;expect(model.info.rows).toBe(expected.length);expect(model.info.columns).toBe(expected.length?5:0);const actual=model.window(0,0,20,5).rows;expect(actual.map(row=>row.map(c=>c.text))).toEqual(expected.map(row=>Array.from({length:5},(_,i)=>row[i]??'')));if(expected.length){expect(actual[2][3].missing).toBe(true);expect(actual[1][3].missing).toBe(false);expect(model.info.newline).toBe('mixed');}}
        const after=statSync(path,{bigint:true});for(const field of ['ino','mtimeNs','ctimeNs'] as const)expect(after[field]).toBe(before[field]);observations.push({file:item.name,sourceSha256:sha(original),bom:!!item.bom,originalBytesPreserved:true,invalid:!!item.invalid});files.closeDocument('csv',document.ref);
      }
    }finally{files.closeOwner('csv');await files.watcher.dispose();broker.dispose();rmSync(base,{recursive:true,force:true})}
  });
});
