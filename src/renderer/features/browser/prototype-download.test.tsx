// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
// @ts-expect-error The shared synthetic prototype is JavaScript.
import {BrowserWorkspace} from '@root/prototypes/m6-codex/src/BrowserWorkspace.jsx';
// @ts-expect-error The shared synthetic model is JavaScript.
import {emptyTaskBrowser,openTab} from '@root/prototypes/m6-codex/src/browser-prototype-model.mjs';
afterEach(cleanup);
function mount(){
  const state={...openTab(emptyTaskBrowser()),downloads:[{id:'d1',name:'订单.csv',state:'done',progress:100}]};
  render(<BrowserWorkspace state={state} onChange={vi.fn()}/>);
}
it('keeps the prototype menu-to-body Escape path aligned with the App',()=>{
  mount();fireEvent.click(screen.getByRole('button',{name:'浏览器菜单'}));
  const item=screen.getByRole('menuitem',{name:'下载'});item.focus();fireEvent.click(item);
  expect(screen.getByRole('region',{name:'下载'})).toBeTruthy();expect(document.activeElement).toBe(document.body);
  fireEvent.keyDown(document.body,{key:'Escape',code:'Escape'});
  expect(screen.queryByRole('region',{name:'下载'})).toBeNull();expect(document.activeElement).toBe(document.body);
  expect(fireEvent.keyDown(document.body,{key:'Escape'})).toBe(true);
});
it('also dismisses prototype downloads while the toolbar retains keyboard focus',()=>{
  mount();const button=screen.getByRole('button',{name:'下载（1）'});button.focus();fireEvent.click(button);
  expect(screen.getByRole('region',{name:'下载'})).toBeTruthy();fireEvent.keyDown(button,{key:'Escape',code:'Escape'});
  expect(screen.queryByRole('region',{name:'下载'})).toBeNull();expect(document.activeElement).toBe(button);
});
