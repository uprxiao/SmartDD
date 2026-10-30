// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor,within}from '@testing-library/react';
import {afterEach,describe,expect,it,vi}from 'vitest';
import {OfficeFidelityNotice}from './fidelity-notice';
import {FileOfficeFidelity}from '../../../../../prototypes/m6-codex/src/FileOfficeFidelity';
const failure={token:'f59ce9d3-c5b8-4921-a003-01186d87932f',version:1,total:1,issues:[{kind:'missing'as const,part:'customXml/vbaProject.bin',message:'非预期缺失'}]};
afterEach(cleanup);
describe('Y13 explicit copy choice and bounded preservation details',()=>{
  it('production: showing or cancelling a confirmation never invokes a copy',async()=>{
    const model={fidelity:failure,canCopyLossy:true,copyingLossy:false,copyNotice:'',saveLossyCopy:vi.fn(async()=>{})};render(<OfficeFidelityNotice model={model}/>);expect(screen.getByText('customXml/vbaProject.bin')).toBeTruthy();expect(model.saveLossyCopy).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'另存有损副本…'}));const dialog=await screen.findByRole('dialog');expect(within(dialog).getByText(/可能无法完整显示或打开/)).toBeTruthy();fireEvent.click(within(dialog).getByRole('button',{name:'取消'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(model.saveLossyCopy).not.toHaveBeenCalled();
  });
  it('production: invokes exactly one copy only after the explicit confirmation',async()=>{
    const model={fidelity:failure,canCopyLossy:true,copyingLossy:false,copyNotice:'',saveLossyCopy:vi.fn(async()=>{})};render(<OfficeFidelityNotice model={model}/>);fireEvent.click(screen.getByRole('button',{name:'另存有损副本…'}));fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'另存有损副本'}));await waitFor(()=>expect(model.saveLossyCopy).toHaveBeenCalledTimes(1));
  });
  it('production: cannot select a stale or busy candidate and displays the bounded remainder',()=>{
    const model={fidelity:{...failure,total:8192},canCopyLossy:false,copyingLossy:true,copyNotice:'',saveLossyCopy:vi.fn(async()=>{})};render(<OfficeFidelityNotice model={model}/>);expect(screen.getByRole('button',{name:'正在另存…'}).matches(':disabled')).toBe(true);expect(screen.getByText('共 8192 项差异，显示前 1 项。')).toBeTruthy();
  });
  for(const state of ['saved','cancelled'])it(`prototype: explicit ${state} receipt keeps original/draft notice`,async()=>{
    const copy=vi.fn(async()=>({state}));render(<FileOfficeFidelity report={failure} onCopy={copy}/>);fireEvent.click(screen.getByRole('button',{name:'另存有损副本…'}));expect(copy).not.toHaveBeenCalled();fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'另存有损副本'}));await waitFor(()=>expect(screen.getByRole('status').textContent).toContain(state==='saved'?'原件未保存':'已取消'));expect(copy).toHaveBeenCalledTimes(1);
  });
  it('prototype: cancel and Escape do not request a copy',()=>{
    const copy=vi.fn(async()=>({state:'saved'}));render(<FileOfficeFidelity report={failure} onCopy={copy}/>);fireEvent.click(screen.getByRole('button',{name:'另存有损副本…'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'取消'}));expect(screen.queryByRole('dialog')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'另存有损副本…'}));fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.queryByRole('dialog')).toBeNull();expect(copy).not.toHaveBeenCalled();
  });
});
