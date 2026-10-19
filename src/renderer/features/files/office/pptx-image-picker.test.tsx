// @vitest-environment jsdom
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,describe,it,expect,vi } from 'vitest';
import { PptxImagePicker } from './pptx-image-picker';
import type { PptxBuffer } from './pptx-buffer';
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}}}));
const bytes=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
const host=()=>({id:'document-one',result:{state:{version:4}},editable:true,controlsBusy:false,composing:false,action:vi.fn(async()=>true)}) as unknown as PptxBuffer;
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('PPTX image chooser input and lifetime',()=>{
  it('submits the selected original bytes with the captured document revision and replacement target',async()=>{
    const pptx=host(),applied=vi.fn();render(<PptxImagePicker pptx={pptx} slideId="256" elementId="9" onApplied={applied}/>);
    fireEvent.click(screen.getByRole('button',{name:'替换图片'}));fireEvent.change(screen.getByLabelText('替换图片文件'),{target:{files:[new File([bytes],'任意后缀.bin',{type:''})]}});
    await waitFor(()=>expect(pptx.action).toHaveBeenCalledOnce());expect(pptx.action).toHaveBeenCalledWith({type:'image-replace',slideId:'256',elementId:'9',image:{mime:'image/png',base64:btoa(String.fromCharCode(...bytes))}},{id:'document-one',version:4});expect(applied).toHaveBeenCalledOnce();
  });
  it('leaves document state alone on chooser cancellation, unsupported content and size failure',async()=>{
    const pptx=host();render(<PptxImagePicker pptx={pptx} slideId="256"/>);const button=screen.getByRole('button',{name:'插入图片'}),input=screen.getByLabelText('插入图片文件');
    fireEvent.click(button);fireEvent.change(input,{target:{files:[]}});expect(pptx.action).not.toHaveBeenCalled();
    fireEvent.change(input,{target:{files:[new File(['<svg/>'],'fake.png',{type:'image/png'})]}});expect((await screen.findByRole('alert')).textContent).toContain('当前支持 PNG 和 JPEG');expect(pptx.action).not.toHaveBeenCalled();
    fireEvent.click(button);fireEvent.change(input,{target:{files:[new File([],'empty.png')]}});await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('20 MiB'));expect(pptx.action).not.toHaveBeenCalled();
  });
  it('invalidates a late FileReader result after changing the target and keeps read-only/IME controls disabled',async()=>{
    let pending:FileReader|undefined;vi.spyOn(FileReader.prototype,'readAsArrayBuffer').mockImplementation(function(this:FileReader){pending=this;});vi.spyOn(FileReader.prototype,'abort').mockImplementation(()=>undefined);
    const pptx=host(),view=render(<PptxImagePicker pptx={pptx} slideId="256" elementId="9"/>);
    fireEvent.click(screen.getByRole('button',{name:'替换图片'}));fireEvent.change(screen.getByLabelText('替换图片文件'),{target:{files:[new File([bytes],'test.png')]}});
    view.rerender(<PptxImagePicker pptx={pptx} slideId="257" elementId="10"/>);Object.defineProperty(pending,'result',{value:bytes.buffer});pending!.onload?.call(pending!,new ProgressEvent('load') as ProgressEvent<FileReader>);
    await waitFor(()=>expect((screen.getByRole('button',{name:'替换图片'}) as HTMLButtonElement).disabled).toBe(false));expect(pptx.action).not.toHaveBeenCalled();
    pptx.composing=true;view.rerender(<PptxImagePicker pptx={pptx} slideId="257" elementId="10"/>);expect((screen.getByRole('button',{name:'替换图片'}) as HTMLButtonElement).disabled).toBe(true);
    pptx.composing=false;Object.defineProperty(pptx,'editable',{value:false});view.rerender(<PptxImagePicker pptx={pptx} slideId="257" elementId="10"/>);expect((screen.getByRole('button',{name:'替换图片'}) as HTMLButtonElement).disabled).toBe(true);
  });
});
