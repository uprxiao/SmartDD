// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {ApplicationResourceChunk} from '@shared/application-data';
import {ResourceView} from './resource-view';
let client:QueryClient;
const ref={id:'00000000-0000-4000-8000-000000000001',revision:'a'.repeat(64),mediaType:'text/html',size:1};
const chunk=(data:string,offset=0,nextOffset:number|null=null):ApplicationResourceChunk=>({resourceId:ref.id,revision:ref.revision,offset,length:new TextEncoder().encode(data).length,encoding:'utf8',data,nextOffset,eof:nextOffset===null});
function mount(read:(offset:number)=>Promise<ApplicationResourceChunk>,mediaType='text/html'){
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return render(<QueryClientProvider client={client}><ResourceView resource={{...ref,mediaType}} scope="p-own" read={read}/></QueryClientProvider>);
}
afterEach(()=>{cleanup();client?.clear();vi.restoreAllMocks();Reflect.deleteProperty(window,'previewAttack');});
describe('bounded inert business resource display',()=>{
 it.each(['text/plain','text/html'])('SQ hides the previous continuation error while the user retries the next %s chunk',async mediaType=>{
  let finish!:(value:ApplicationResourceChunk)=>void;
  const read=vi.fn<(offset:number)=>Promise<ApplicationResourceChunk>>()
   .mockResolvedValueOnce(chunk(mediaType==='text/html'?'<p>本窗口已读部分</p>':'本窗口已读部分',0,30))
   .mockRejectedValueOnce(Error('上一轮后续块不可读'))
   .mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  mount(read,mediaType);await screen.findByText('本窗口已读部分');
  fireEvent.click(screen.getByRole('button',{name:'继续读取内容'}));await screen.findByText('上一轮后续块不可读');
  fireEvent.click(screen.getByRole('button',{name:'继续读取内容'}));
  await waitFor(()=>expect(read).toHaveBeenCalledTimes(3));
  await waitFor(()=>expect(screen.queryByText('上一轮后续块不可读')).toBeNull());
  expect(screen.queryByRole('button',{name:'重试'})).toBeNull();
  expect(screen.getByText('本窗口已读部分')).toBeTruthy();
  expect((screen.getByRole('button',{name:'继续读取内容'}) as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>finish(chunk(mediaType==='text/html'?'<p>恢复后的后续块</p>':'恢复后的后续块',30)));
  await screen.findByText(/本窗口已读部分[\s\S]*恢复后的后续块/);
  expect(read.mock.calls.map(call=>call[0])).toEqual([0,30,30]);
  expect(screen.queryByRole('button',{name:'继续读取内容'})).toBeNull();
  expect(screen.queryByRole('button',{name:'重试'})).toBeNull();
 });
 it.each(['text/html','TEXT/HTML; charset=UTF-8',' text/HTML ;charset=utf-8'])('renders %s as text without attaching active content',async mediaType=>{
  const html='<p>可读 &amp; 中文</p><script>window.previewAttack=1</script><style>@import "https://preview.invalid/style";</style><iframe src="https://preview.invalid/frame">frame</iframe><object data="https://preview.invalid/object">object</object><embed src="https://preview.invalid/embed"><img src="https://preview.invalid/pixel" onerror="window.previewAttack=2"><svg onload="window.previewAttack=3"><image href="https://preview.invalid/svg"/></svg><form action="https://preview.invalid/submit"><button>表单文字</button></form><a href="javascript:window.previewAttack=4">链接文字</a>';
  const {container}=mount(async()=>chunk(html),mediaType);await screen.findByText(/可读 & 中文/);
  const pre=container.querySelector('pre')!;expect(pre.textContent).toContain('表单文字');expect(pre.textContent).toContain('链接文字');expect(pre.textContent).not.toMatch(/previewAttack|@import|frame|object/);
  expect(pre.children.length).toBe(0);expect(container.querySelectorAll('script,style,img,svg,image,iframe,object,embed,form,a,link').length).toBe(0);expect(Reflect.get(window,'previewAttack')).toBeUndefined();
 });
 it('leaves plain source text literal and does not parse it as HTML',async()=>{
  const parser=vi.spyOn(DOMParser.prototype,'parseFromString');mount(async()=>chunk('<script>literal user text</script>'),'text/plain');await screen.findByText('<script>literal user text</script>');expect(parser).not.toHaveBeenCalled();
 });
 it('joins split UTF-8 bytes before decoding and only reads a second chunk after the user asks',async()=>{
  const bytes=new TextEncoder().encode('<p>分块中文🙂</p>'),split=6;
  const read=vi.fn(async(offset:number)=>{const part=offset===0?bytes.slice(0,split):bytes.slice(split);return{...chunk('',offset,offset===0?split:null),length:part.length,encoding:'base64' as const,data:btoa(String.fromCharCode(...part))};});
  mount(read);await screen.findByRole('button',{name:'继续读取内容'});expect(read.mock.calls.map(v=>v[0])).toEqual([0]);fireEvent.click(screen.getByRole('button',{name:'继续读取内容'}));await screen.findByText('分块中文🙂');expect(read.mock.calls.map(v=>v[0])).toEqual([0,split]);expect(screen.queryByText(/�/)).toBeNull();
 });
 it('keeps partial text and an explicit error when the next chunk is no longer authorized',async()=>{
  const read=vi.fn(async(offset:number)=>{if(offset)throw Error('当前项目已停用，未继续读取');return chunk('<p>已读部分</p>',0,22);});
  mount(read);await screen.findByText('已读部分');fireEvent.click(screen.getByRole('button',{name:'继续读取内容'}));await screen.findByText('当前项目已停用，未继续读取');expect(screen.getByText('已读部分')).toBeTruthy();expect(screen.getByText('内容读取未完成')).toBeTruthy();expect(read).toHaveBeenCalledTimes(2);
 });
 it('OX-01 reopens at the first chunk without showing cached text or automatically rereading old later pages',async()=>{
  const read=vi.fn(async(offset:number)=>chunk(offset?'第二块内容':'首块内容',offset,offset?null:12));
  const view=mount(read,'text/plain');await screen.findByText('首块内容');fireEvent.click(screen.getByRole('button',{name:'继续读取内容'}));await screen.findByText('首块内容第二块内容');view.unmount();
  let finish!:(value:ApplicationResourceChunk)=>void;read.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const reopened=render(<QueryClientProvider client={client}><ResourceView resource={{...ref,mediaType:'text/plain'}} scope="p-own" read={read}/></QueryClientProvider>);await waitFor(()=>expect(read).toHaveBeenCalledTimes(3));expect(reopened.container.textContent).not.toContain('首块内容');expect(reopened.container.textContent).not.toContain('第二块内容');expect(screen.getByText('正在读取原内容…')).toBeTruthy();await act(async()=>finish(chunk('新核验首块',0,12)));await screen.findByText('新核验首块');expect(read.mock.calls.map(v=>v[0])).toEqual([0,12,0]);expect(screen.queryByText(/第二块内容/)).toBeNull();
 });
 it('OX-01 hides all cached chunks if a reopened original read fails',async()=>{
  const read=vi.fn(async()=>chunk('上次打开的正文'));const view=mount(read,'text/plain');await screen.findByText('上次打开的正文');view.unmount();read.mockRejectedValueOnce(Error('原修订已损坏'));
  render(<QueryClientProvider client={client}><ResourceView resource={{...ref,mediaType:'text/plain'}} scope="p-own" read={read}/></QueryClientProvider>);await screen.findByText('原修订已损坏');expect(screen.queryByText('上次打开的正文')).toBeNull();expect(screen.queryByRole('button',{name:'继续读取内容'})).toBeNull();expect(screen.getByRole('button',{name:'重试'})).toBeTruthy();
 });
 it('OX-01 retains this opening’s partial read on a next-page failure,then revalidates from the start on explicit retry',async()=>{
  const read=vi.fn(async(offset:number)=>{if(offset)throw Error('本次下一块不可读');return chunk('本窗口已读部分',0,30);});mount(read,'text/plain');await screen.findByText('本窗口已读部分');fireEvent.click(screen.getByRole('button',{name:'继续读取内容'}));await screen.findByText('本次下一块不可读');expect(screen.getByText('本窗口已读部分')).toBeTruthy();let fail!:(error:Error)=>void;read.mockImplementationOnce(()=>new Promise((_resolve,reject)=>{fail=reject;}));fireEvent.click(screen.getByRole('button',{name:'重试'}));await waitFor(()=>expect(read).toHaveBeenCalledTimes(3));expect(screen.queryByText('本窗口已读部分')).toBeNull();expect(screen.getByText('正在读取原内容…')).toBeTruthy();await act(async()=>fail(Error('原首块核验失败')));await screen.findByText('原首块核验失败');expect(screen.queryByText('本窗口已读部分')).toBeNull();expect(screen.queryByRole('button',{name:'继续读取内容'})).toBeNull();read.mockResolvedValueOnce(chunk('恢复后的首块',0,30));fireEvent.click(screen.getByRole('button',{name:'重试'}));await screen.findByText('恢复后的首块');expect(read.mock.calls.map(v=>v[0])).toEqual([0,30,0,0]);expect(screen.getByRole('button',{name:'继续读取内容'})).toBeTruthy();
 });
});
