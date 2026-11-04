// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {BrowserDownload} from '@shared/browser-downloads';
import {BrowserDownloadPanel} from './download-panel';
const item=():BrowserDownload=>({id:'d1',taskId:'t1',pageId:'p1',url:'https://site.example/download',name:'订单.csv',path:'/synthetic/Downloads/订单.csv',state:'progress',receivedBytes:20,totalBytes:100,updatedAt:Date.now(),error:null});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-04T02:10:00Z'));});afterEach(()=>{cleanup();vi.useRealTimers();});
it('dismisses six seconds after the last change and holds dismissal while hovered',()=>{
  const close=vi.fn();render(<BrowserDownloadPanel items={[item()]} onAction={vi.fn()} onClose={close}/>);act(()=>vi.advanceTimersByTime(5999));expect(close).not.toHaveBeenCalled();fireEvent.mouseEnter(screen.getByRole('region',{name:'下载'}));act(()=>vi.advanceTimersByTime(10000));expect(close).not.toHaveBeenCalled();fireEvent.mouseLeave(screen.getByRole('region',{name:'下载'}));act(()=>vi.advanceTimersByTime(0));expect(close).toHaveBeenCalledOnce();
});
it('uses actual progress changes as the dismissal deadline rather than the first download event',()=>{
  const close=vi.fn(),action=vi.fn(),row=item(),view=render(<BrowserDownloadPanel items={[row]} onAction={action} onClose={close}/>);act(()=>vi.advanceTimersByTime(4000));view.rerender(<BrowserDownloadPanel items={[{...row,receivedBytes:80,updatedAt:Date.now()}]} onAction={action} onClose={close}/>);act(()=>vi.advanceTimersByTime(5999));expect(close).not.toHaveBeenCalled();act(()=>vi.advanceTimersByTime(1));expect(close).toHaveBeenCalledOnce();
});
it('routes cancel and completed-file actions with the record identity, and closes on Escape',async()=>{
  const close=vi.fn(),action=vi.fn(async()=>{}),row=item(),view=render(<BrowserDownloadPanel items={[row]} onAction={action} onClose={close}/>);expect(screen.queryByRole('button',{name:'打开'})).toBeNull();await act(async()=>fireEvent.click(screen.getByRole('button',{name:'取消'})));expect(action).toHaveBeenLastCalledWith('d1','cancel');view.rerender(<BrowserDownloadPanel items={[{...row,state:'done'}]} onAction={action} onClose={close}/>);await act(async()=>fireEvent.click(screen.getByRole('button',{name:'移除下载记录 订单.csv'})));expect(action).toHaveBeenLastCalledWith('d1','remove');fireEvent.keyDown(screen.getByRole('region',{name:'下载'}),{key:'Escape'});expect(close).toHaveBeenCalledOnce();
});
