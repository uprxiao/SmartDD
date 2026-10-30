import { describe, expect, it, vi } from 'vitest';
import { FileMediaService } from './media-service';
import { FileResourceService } from './resource-service';
import { installMediaProtocol, registerViewerAssetScheme } from './viewer-assets';

const native = vi.hoisted(() => ({ before: vi.fn(), handle: vi.fn(), register: vi.fn() }));
vi.mock('electron', () => ({ protocol: { handle: native.handle, registerSchemesAsPrivileged: native.register }, session: { defaultSession: { webRequest: { onBeforeRequest: native.before } } } }));
describe('media session gate', () => {
  it('registers streaming without fetch/CSP bypass and rejects child or foreign frames before protocol IO', () => {
    registerViewerAssetScheme();
    expect(native.register.mock.calls[0][0]).toContainEqual({ scheme: 'willyou-media', privileges: { standard: true, secure: true, stream: true } });
    const service = new FileMediaService(() => { throw new Error('unused'); }), allowed = vi.spyOn(service, 'allows').mockImplementation((owner) => owner === '1:2:3');
    installMediaProtocol(service);
    const handler = native.before.mock.calls[0][1], frame = { processId: 2, routingId: 3 }, callback = vi.fn();
    const contents = { id: 1, mainFrame: frame };
    handler({ frame, webContents: contents, url: 'willyou-media://local/token' }, callback); expect(callback).toHaveBeenLastCalledWith({ cancel: false });
    handler({ frame: { ...frame, routingId: 4 }, webContents: contents, url: 'willyou-media://local/token' }, callback); expect(callback).toHaveBeenLastCalledWith({ cancel: true });
    handler({ frame, webContents: { id: 9, mainFrame: frame }, url: 'willyou-media://local/token' }, callback); expect(callback).toHaveBeenLastCalledWith({ cancel: true });
    handler({ frame: null, url: 'willyou-media://local/token' }, callback); expect(callback).toHaveBeenLastCalledWith({ cancel: true });
    expect(allowed).toHaveBeenCalledTimes(2);
  });
  it('uses one combined listener for media and protected image/PDF fetches, including media binary mode',()=>{
    native.before.mockClear();native.handle.mockClear();const media=new FileMediaService(()=>{throw Error('unused')}),resources=new FileResourceService(()=>{throw Error('unused')});vi.spyOn(resources,'allows').mockImplementation(owner=>owner==='1:2:3');
    installMediaProtocol(media,resources,true);expect(native.before).toHaveBeenCalledTimes(1);expect(native.before.mock.calls[0][0].urls).toEqual(['willyou-media://*/*','willyou-resource://*/*']);expect(native.handle.mock.calls.map(x=>x[0])).toEqual(['willyou-resource']);
    const gate=native.before.mock.calls[0][1],frame={processId:2,routingId:3},contents={id:1,mainFrame:frame},callback=vi.fn();gate({frame,webContents:contents,url:'willyou-resource://local/token'},callback);expect(callback).toHaveBeenLastCalledWith({cancel:false});
    gate({frame,webContents:{id:2,mainFrame:frame},url:'willyou-resource://local/token'},callback);expect(callback).toHaveBeenLastCalledWith({cancel:true});gate({frame:null,webContents:contents,url:'willyou-resource://local/token'},callback);expect(callback).toHaveBeenLastCalledWith({cancel:true});gate({frame,webContents:contents,url:'willyou-media://local/token'},callback);expect(callback).toHaveBeenLastCalledWith({cancel:true});
  });
});
