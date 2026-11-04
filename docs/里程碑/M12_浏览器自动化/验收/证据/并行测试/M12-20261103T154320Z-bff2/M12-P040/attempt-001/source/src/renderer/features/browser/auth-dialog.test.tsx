// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BrowserAuthDialog} from './auth-dialog';
const prompt={id:'request',pageId:'page',profileId:'profile',url:'https://site.example/private',host:'site.example',realm:'Private area',proxy:false};
afterEach(cleanup);
it('submits credentials only on an explicit login, masks the password input, and clears values after host acknowledgement',async()=>{
  const respond=vi.fn(async()=>{});render(<BrowserAuthDialog prompt={prompt} onRespond={respond}/>);expect(respond).not.toHaveBeenCalled();const password=screen.getByLabelText('基本认证密码') as HTMLInputElement;expect(password.type).toBe('password');fireEvent.change(screen.getByLabelText('基本认证用户名'),{target:{value:'qa'}});fireEvent.change(password,{target:{value:'synthetic-secret'}});expect(respond).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'登录'}));await waitFor(()=>expect(respond).toHaveBeenCalledWith({user:'qa',pass:'synthetic-secret'}));await waitFor(()=>expect(password.value).toBe(''));
});
it('cancels without forwarding typed credentials and keeps failures visible without declaring login success',async()=>{
  const respond=vi.fn().mockRejectedValueOnce(new Error('prompt no longer current'));render(<BrowserAuthDialog prompt={prompt} onRespond={respond}/>);fireEvent.change(screen.getByLabelText('基本认证密码'),{target:{value:'synthetic-secret'}});fireEvent.click(screen.getByRole('button',{name:'取消'}));await screen.findByRole('alert');expect(respond).toHaveBeenLastCalledWith(null);expect(screen.getByRole('dialog')).toBeTruthy();
});
