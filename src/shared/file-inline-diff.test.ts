import { describe, expect, it } from 'vitest';
import { fileInlineDiffPolicy } from './file-inline-diff.mjs';
describe('H33 raw source inline diff budget',()=>{
 it.each([262143,262144,262145])('UTF16 units %i applies independently to either source',length=>{
  const text='😀'+'a'.repeat(length-2);
  for(const [disk,local]of[[text,'L'],['D',text]])expect(fileInlineDiffPolicy(disk,local).state).toBe(length>262144?'too-large':'enabled');
 });
 it.each(['\n','\r\n','\r'])('counts %j EOL as one source line without changing source',eol=>{
  for(const lines of[4999,5000,5001]){
   const text=Array(lines).fill('中文').join(eol);
   for(const [disk,local]of[[text,'L'],['D',text]])expect(fileInlineDiffPolicy(disk,local).state).toBe(lines>5000?'too-large':'enabled');
  }
 });
 it('keeps empty sources eligible and missing disk distinct from a genuine empty file',()=>{
  expect(fileInlineDiffPolicy('','').state).toBe('enabled');expect(fileInlineDiffPolicy(null,'L').state).toBe('none');
 });
 it('accounts for raw CRLF units before normalized editor positions',()=>{
  const source='x'.repeat(262141)+'\r\n';expect(fileInlineDiffPolicy(source,'L').state).toBe('enabled');
  expect(fileInlineDiffPolicy(source+'xy','L').state).toBe('too-large');
 });
 it('does not confuse a trailing line break with only 5000 lines',()=>{
  expect(fileInlineDiffPolicy('x\n'.repeat(5000),'L').state).toBe('too-large');
  expect(fileInlineDiffPolicy('x\n'.repeat(4999)+'x','L').state).toBe('enabled');
 });
 it('reports a visible bounded reason without selecting a resolution',()=>{
  const units=fileInlineDiffPolicy('a'.repeat(262145),'L'),lines=fileInlineDiffPolicy('D','x\n'.repeat(5000));
  expect(units.reason).toMatch(/262144/);expect(lines.reason).toMatch(/5000/);expect(units).not.toHaveProperty('resolution');
 });
});
