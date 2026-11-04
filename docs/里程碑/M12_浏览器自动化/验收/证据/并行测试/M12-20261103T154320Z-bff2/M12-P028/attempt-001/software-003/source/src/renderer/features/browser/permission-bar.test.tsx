// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {BrowserPermissionBar} from './permission-bar';
const prompt={id:'request',pageId:'page',profileId:'profile',origin:'https://child.example:8443',permissions:['geolocation']};
afterEach(cleanup);
it('waits for an explicit choice, displays the requesting origin, and preserves the prompt if the host rejects saving',async()=>{
  const resolve=vi.fn().mockRejectedValueOnce(new Error('write refused'));render(<BrowserPermissionBar prompt={prompt} onResolve={resolve}/>);expect(resolve).not.toHaveBeenCalled();expect(screen.getByText(prompt.origin)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'允许'}));await screen.findByRole('alert');expect(resolve).toHaveBeenLastCalledWith(true);expect(screen.getByRole('alertdialog',{name:'站点权限请求'})).toBeTruthy();resolve.mockResolvedValueOnce(undefined);fireEvent.click(screen.getByRole('button',{name:'拒绝'}));await waitFor(()=>expect(resolve).toHaveBeenLastCalledWith(false));
});
it('blocks duplicate answers while a choice is awaiting host acknowledgement',async()=>{
  let finish!:()=>void;const resolve=vi.fn(()=>new Promise<void>(done=>{finish=done;}));render(<BrowserPermissionBar prompt={{...prompt,permissions:['media:video','media:audio']}} onResolve={resolve}/>);fireEvent.click(screen.getByRole('button',{name:'允许'}));expect((screen.getByRole('button',{name:'拒绝'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'允许'}));expect(resolve).toHaveBeenCalledTimes(1);finish();await waitFor(()=>expect((screen.getByRole('button',{name:'拒绝'}) as HTMLButtonElement).disabled).toBe(false));
});
