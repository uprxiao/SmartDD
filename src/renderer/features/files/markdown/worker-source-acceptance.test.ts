import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {afterAll,describe,expect,it} from 'vitest';
import {malformedMarkdownFixtures} from '../../../../../scripts/files/markdown-worker-fixtures.mjs';
import {analyze,renderWindow} from './model.mjs';
const rows:unknown[]=[],sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
describe('Y06 malformed Markdown authoritative source',()=>{
 it.each(malformedMarkdownFixtures())('retains exact raw ranges and bytes for $name',({name,source,encoding})=>{
  const before=Buffer.from(source,encoding),start=performance.now(),{parsed,index}=analyze(source),parsedAt=performance.now(),blocks=(parsed as {blocks:{raw:string}[]}).blocks;expect(Array.isArray(blocks)).toBe(true);const raw=blocks.map(block=>block.raw).join('');expect(raw).toBe(source);expect(Buffer.from(raw,encoding)).toEqual(before);
  let end=0;for(let at=0;at<index.length;at+=4){expect(index[at]).toBe(end);end=index[at+1];}expect(end).toBe(source.length);let items=0,sourceOnly=0;for(let start=0;start<blocks.length;start+=60){const window=renderWindow(parsed,start,60);expect(window.length).toBeLessThanOrEqual(60);for(const item of window){expect(item.to).toBeLessThanOrEqual(source.length);if(item.sourceOnly)sourceOnly++;}items+=window.length;}rows.push({name,encoding,bytes:before.length,utf16Units:source.length,sha256:sha(before),rawSha256:sha(Buffer.from(raw,encoding)),blocks:blocks.length,items,sourceOnly,parseMs:parsedAt-start,renderMs:performance.now()-parsedAt,boundary:'Raw UTF-16 ranges; lone surrogate bytes are UTF-16LE, not a claim of valid UTF-8. No performance pass threshold applied in this functional source check.'});
 },30000);
});
afterAll(()=>{if(process.env.SMARTDD_MARKDOWN_SOURCE_EVIDENCE)writeFileSync(process.env.SMARTDD_MARKDOWN_SOURCE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),caseId:'M9-T-Y06',layer:'U actual parser/renderWindow, no Worker/UI claim',rows},null,2)+'\n');});
