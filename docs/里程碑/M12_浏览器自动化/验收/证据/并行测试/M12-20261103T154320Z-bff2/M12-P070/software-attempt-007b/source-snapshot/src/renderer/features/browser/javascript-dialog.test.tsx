// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BrowserJavascriptDialogView} from './javascript-dialog';
const dialog={id:'request1',pageId:'page1',profileId:'profile1',kind:'prompt' as const,url:'https://site.example/frame',message:'Question\n中文',defaultValue:'初始'};
afterEach(cleanup);
it('prefills a prompt and sends an empty value only after an explicit acceptance',async()=>{
  const reply=vi.fn(async()=>{});render(<BrowserJavascriptDialogView dialog={dialog} onRespond={reply}/>);
  const input=screen.getByLabelText('网页输入内容') as HTMLInputElement;expect(input.value).toBe('初始');expect(reply).not.toHaveBeenCalled();
  fireEvent.change(input,{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:'确定'}));await waitFor(()=>expect(reply).toHaveBeenCalledExactlyOnceWith(true,''));
});
it('cancels through Escape without sending entered text',async()=>{
  const reply=vi.fn(async()=>{});render(<BrowserJavascriptDialogView dialog={dialog} onRespond={reply}/>);fireEvent.change(screen.getByLabelText('网页输入内容'),{target:{value:'private text'}});fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});await waitFor(()=>expect(reply).toHaveBeenCalledExactlyOnceWith(false,undefined));
});
it('keeps the input and a visible error when a native reply fails',async()=>{
  const reply=vi.fn().mockRejectedValueOnce(new Error('The dialog expired'));render(<BrowserJavascriptDialogView dialog={dialog} onRespond={reply}/>);fireEvent.change(screen.getByLabelText('网页输入内容'),{target:{value:'keep this'}});fireEvent.click(screen.getByRole('button',{name:'确定'}));expect((await screen.findByRole('alert')).textContent).toBe('The dialog expired');expect((screen.getByLabelText('网页输入内容')as HTMLInputElement).value).toBe('keep this');
});
it.each(['alert','confirm','prompt']as const)('restores keyboard focus after a failed %s reply so Escape can still cancel',async kind=>{
  let fail!:(error:Error)=>void;
  const reply=vi.fn().mockImplementationOnce(()=>new Promise<void>((_resolve,reject)=>{fail=reject;})).mockResolvedValueOnce(undefined);
  render(<><button>Outside modal</button><BrowserJavascriptDialogView dialog={{...dialog,kind}} onRespond={reply}/></>);
  const confirm=screen.getByRole('button',{name:'确定'});confirm.focus();fireEvent.click(confirm);
  // Model Chromium's focus leaving disabled controls. jsdom cannot blur a
  // disabled button, so a separate focusable sentinel represents that effect.
  const outside=screen.getByRole('button',{name:'Outside modal'});outside.focus();expect(document.activeElement).toBe(outside);
  await act(async()=>{fail(new Error('Reply unavailable'));});
  expect((await screen.findByRole('alert')).textContent).toBe('Reply unavailable');
  expect(document.activeElement).toBe(kind==='prompt'?screen.getByLabelText('网页输入内容'):confirm);
  fireEvent.keyDown(document.activeElement!,{key:'Escape'});
  await waitFor(()=>expect(reply).toHaveBeenNthCalledWith(2,false,undefined));
});
it('renders alert text without an editable field or an automatic response',async()=>{
  const reply=vi.fn(async()=>{});render(<BrowserJavascriptDialogView dialog={{...dialog,kind:'alert',message:'<script>unsafe()</script>'}} onRespond={reply}/>);expect(screen.queryByRole('textbox')).toBeNull();expect(screen.getByText('<script>unsafe()</script>')).toBeTruthy();expect(reply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确定'}));await waitFor(()=>expect(reply).toHaveBeenCalledExactlyOnceWith(true,undefined));
});
