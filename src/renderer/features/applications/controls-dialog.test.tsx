// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AppDialog} from './controls';
const showModal=HTMLDialogElement.prototype.showModal,close=HTMLDialogElement.prototype.close;
beforeEach(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};});
afterEach(()=>{cleanup();HTMLDialogElement.prototype.showModal=showModal;HTMLDialogElement.prototype.close=close;vi.restoreAllMocks();});
it('PU keeps root padding and child clicks open; only an actual outside coordinate closes the dialog',()=>{
 const onClose=vi.fn();render(<AppDialog title="Review selection" onClose={onClose}><p>Keep the original selection</p></AppDialog>);const dialog=screen.getByRole('dialog');
 vi.spyOn(dialog,'getBoundingClientRect').mockReturnValue({x:100,y:80,left:100,top:80,right:500,bottom:380,width:400,height:300,toJSON:()=>({})});
 fireEvent.click(dialog,{clientX:104,clientY:230});fireEvent.click(dialog,{clientX:496,clientY:230});fireEvent.click(screen.getByText('Keep the original selection'),{clientX:150,clientY:170});expect(onClose).not.toHaveBeenCalled();
 fireEvent.click(dialog,{clientX:8,clientY:8});expect(onClose).toHaveBeenCalledTimes(1);
});
it('PU still delegates Escape and the explicit close button, and disables the close button when busy',()=>{
 const onClose=vi.fn();const view=render(<AppDialog title="Review selection" onClose={onClose}><p>Review only</p></AppDialog>);fireEvent.click(screen.getByRole('button',{name:'关闭弹窗'}));fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true,cancelable:true}));expect(onClose).toHaveBeenCalledTimes(2);
 view.rerender(<AppDialog title="Review selection" closingDisabled onClose={onClose}><p>Review only</p></AppDialog>);const button=screen.getByRole('button',{name:'关闭弹窗'});expect(button).toHaveProperty('disabled',true);fireEvent.click(button);expect(onClose).toHaveBeenCalledTimes(2);
});
it('TU cancels only the innermost attachment chooser without dismissing the saved draft',()=>{
 const parent=vi.fn(),child=vi.fn();render(<AppDialog title="Saved draft" onClose={parent}><AppDialog title="Attachment application" onClose={child}><p>Choose an application</p></AppDialog></AppDialog>);
 fireEvent(screen.getByRole('dialog',{name:'Attachment application'}),new Event('cancel',{bubbles:false,cancelable:true}));expect(child).toHaveBeenCalledTimes(1);expect(parent).not.toHaveBeenCalled();
});
it('TU honors busy closing protection for native cancel and outside pointer as well as the close button',()=>{
 const onClose=vi.fn();render(<AppDialog title="Native request in flight" closingDisabled onClose={onClose}><p>Wait for its actual receipt</p></AppDialog>);const dialog=screen.getByRole('dialog');
 vi.spyOn(dialog,'getBoundingClientRect').mockReturnValue({x:100,y:80,left:100,top:80,right:500,bottom:380,width:400,height:300,toJSON:()=>({})});
 fireEvent(dialog,new Event('cancel',{bubbles:false,cancelable:true}));fireEvent.click(dialog,{clientX:8,clientY:8});expect(onClose).not.toHaveBeenCalled();
});
