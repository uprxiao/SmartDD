import {beforeEach,describe,it,expect,vi} from 'vitest';
import type {FileBuffer} from '../file-buffer';
import type {NotebookClient} from './client';
import {notebookRelatedImage} from './assets';
import {notebookImageData} from './image-data';
const related=vi.hoisted(()=>vi.fn());
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{related}}}));
const buffer={} as FileBuffer;
beforeEach(()=>vi.clearAllMocks());
describe('Notebook inline Markdown images',()=>{
 it.each(['png','jpeg']as const)('keeps inline %s bytes out of the local path resolver',async mime=>{
  const client={}as NotebookClient,result=await notebookRelatedImage(buffer,client,`data:image/${mime};base64,YWJj`,new AbortController().signal);
  expect(result).toEqual({mime:`image/${mime}`,data:'YWJj'});expect(related).not.toHaveBeenCalled();
 });
 it('sends inline SVG through the actual worker client sanitizer before returning it',async()=>{
  const svg=vi.fn(async()=>'<svg/>'),source='<svg><script>bad()</script></svg>',result=await notebookRelatedImage(buffer,{svg}as unknown as NotebookClient,'data:image/svg+xml,'+encodeURIComponent(source),new AbortController().signal);
  expect(svg).toHaveBeenCalledWith(source);expect(result).toEqual({mime:'image/svg+xml',data:'<svg/>'});expect(related).not.toHaveBeenCalled();
 });
 it('rejects unsupported MIME, invalid Base64, oversized SVG and aborted inputs before any file lookup',async()=>{
  for(const href of ['data:text/html;base64,YWJj','data:image/png,abc','data:image/png;base64,%%%','data:image/png;base64,A'])expect(()=>notebookImageData(href)).toThrow();
  expect(()=>notebookImageData('data:image/svg+xml,'+'x'.repeat(3*1024*1024))).toThrow('预览上限');
  const abort=new AbortController();abort.abort();await expect(notebookRelatedImage(buffer,{}as NotebookClient,'data:image/png;base64,YWJj',abort.signal)).rejects.toThrow();expect(related).not.toHaveBeenCalled();
 });
});
