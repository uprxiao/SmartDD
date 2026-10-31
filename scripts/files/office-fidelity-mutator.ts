import { createHash } from 'node:crypto';
import { OfficePackage } from '../../src/main/core/files/office/package';

/** External acceptance fixture only: corrupt one delivered save candidate,
 * leaving the original document Worker/model and file untouched. */
export async function mutateCandidate(bytes:Uint8Array,mode:string){
  const file=await OfficePackage.read(bytes);
  const names:Record<string,string>={missing:'customXml/vbaProject.bin','unrelated-rewrite':'customXml/revisions.xml','layout-rewrite':'customXml/layout.xml','broken-relationship':'customXml/_rels/item1.xml.rels'};
  const part=names[mode];if(!part||!file.has(part))throw Error('Own fidelity fixture/operation is absent');
  const data=mode==='missing'?null:Buffer.from(file.read(part).toString().replace(mode==='unrelated-rewrite'?'KEEP REVISION':mode==='layout-rewrite'?'margin="137"':'annotations.xml',mode==='unrelated-rewrite'?'LOST REVISION':mode==='layout-rewrite'?'margin="0"':'absent.xml'));
  const next=file.patch(new Map([[part,data]]),{changed:data?[part]:[],added:[],removed:data?[]:[part]}),output=await next.bytes();
  const sha=(x:Uint8Array)=>createHash('sha256').update(x).digest('hex');if(sha(bytes)===sha(output))throw Error('Own fidelity fault did not change the candidate');
  return {bytes:output,hash:sha(output),mutation:{mode,part,beforeHash:sha(bytes),afterHash:sha(output),beforeParts:file.hashes(),afterParts:next.hashes()}};
}
