// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,it,expect,vi } from 'vitest';
import type { PptxBuffer } from './pptx-buffer';
import { PptxChartValues } from './pptx-chart-values';
import type { PptxElementInfo } from '@shared/file-pptx-elements';
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}}}));
const element:PptxElementInfo={id:'4',name:'Chart',kind:'chart',hidden:false,chart:{type:'bar',values:[9,4],editableValues:true}};
const host=()=>({id:'document',result:{state:{version:5}},editable:true,controlsBusy:false,composing:false,pendingFor:vi.fn(()=>undefined),beginChartValues:vi.fn(()=>true),setChartValues:vi.fn(),setComposing:vi.fn(),finishElementText:vi.fn(async()=>true),cancelElementText:vi.fn(()=>true)}) as unknown as PptxBuffer;
afterEach(cleanup);
describe('PPTX chart raw data input',()=>{
  it('targets numeric input by object and version and does not submit IME Enter or Escape',async()=>{
    const pptx=host();render(<PptxChartValues pptx={pptx} slideId="256" element={element}/>);const field=screen.getByRole('textbox',{name:'图表数据'});
    fireEvent.focus(field);expect(pptx.beginChartValues).toHaveBeenCalledWith('256','4');fireEvent.change(field,{target:{value:'15,'}});expect(pptx.setChartValues).toHaveBeenCalledWith('256','4','15,','9,4',5);
    fireEvent.compositionStart(field);expect(pptx.setComposing).toHaveBeenCalledWith(true);fireEvent.keyDown(field,{key:'Enter',isComposing:true});fireEvent.keyDown(field,{key:'Escape',keyCode:229});expect(pptx.finishElementText).not.toHaveBeenCalled();expect(pptx.cancelElementText).not.toHaveBeenCalled();
    fireEvent.compositionEnd(field);fireEvent.keyDown(field,{key:'Enter'});await waitFor(()=>expect(pptx.finishElementText).toHaveBeenCalledWith({slideId:'256',elementId:'4',chartValues:true}));
  });
  it('restores unfinished input without overwriting it and disables unsupported or read-only editing',()=>{
    const pptx=host();vi.mocked(pptx.pendingFor).mockReturnValue({slideId:'256',elementId:'4',chartValues:true,text:'7,待定,'});pptx.elementEditing={slideId:'256',elementId:'4',chartValues:true};
    const view=render(<PptxChartValues pptx={pptx} slideId="256" element={element}/>);expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('7,待定,');expect(document.activeElement).toBe(screen.getByRole('textbox'));
    Object.defineProperty(pptx,'editable',{value:false});view.rerender(<PptxChartValues pptx={pptx} slideId="256" element={element}/>);expect((screen.getByRole('textbox') as HTMLInputElement).disabled).toBe(true);
  });
});
