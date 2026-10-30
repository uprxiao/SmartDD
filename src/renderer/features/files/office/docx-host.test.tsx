// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { FileBuffer } from '../file-buffer';

const mocks=vi.hoisted(()=>({get:vi.fn(),open:vi.fn(),release:vi.fn().mockResolvedValue(undefined),target:{},root:{lease:'lease',generation:1}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{appSettings:{getWithMeta:mocks.get},files:{openDocxSource:mocks.open,releaseOfficePages:mocks.release}}}));
vi.mock('./pages-preview',()=>({FileOfficePagesPreview:()=>createElement('div',{'data-testid':'popcorn'})}));
vi.mock('../terminal-context/context',()=>({useFileTerminalContext:()=>({target:mocks.target,root:mocks.root,subscribe:()=>()=>undefined,snapshot:()=>0})}));
vi.mock('./docx-context',()=>({useDocxRequests:()=>({commentDraft:'',panel:null})}));
import { TaskDocxPreview } from './docx-preview';

const buffer={instance:'one',baseHash:'source',sourceUnavailable:false,file:{ref:{id:'ref',lease:'lease',generation:1},revision:{size:42}}} as unknown as FileBuffer;
const meta=(documentHostFlag:boolean,renderFlag:boolean,redlinesEnabled:boolean)=>({value:{docx:{documentHostFlag,renderFlag,redlinesEnabled}}});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function mount(file:FileBuffer=buffer){const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});render(createElement(QueryClientProvider,{client},createElement(TaskDocxPreview,{buffer:file})));return client;}

it('does not start a source renderer before the actual app policy arrives; a failed read can be retried', async()=>{
  mocks.get.mockRejectedValueOnce(new Error('policy unavailable')).mockResolvedValue(meta(true,true,false));
  mount();expect(mocks.open).not.toHaveBeenCalled();
  await screen.findByRole('alert');expect(screen.queryByTestId('popcorn')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'重试'}));await screen.findByTestId('popcorn');
  expect(mocks.get).toHaveBeenCalledTimes(2);expect(mocks.get).toHaveBeenCalledWith('fileOffice');expect(mocks.open).not.toHaveBeenCalled();
});

it.each([[false,false],[false,true],[true,false]])('keeps ordinary DOCX on the byte-authorized legacy route for policy %s/%s despite a live terminal',async(documentHostFlag,renderFlag)=>{
  mocks.get.mockResolvedValue(meta(documentHostFlag,renderFlag,true));mocks.open.mockRejectedValue(new Error('source sentinel'));
  mount();await waitFor(()=>expect(mocks.open).toHaveBeenCalledOnce());expect(screen.queryByTestId('popcorn')).toBeNull();
  expect(mocks.open.mock.calls[0][0]).toMatchObject({ref:buffer.file.ref,baseHash:'source'});
  await screen.findByRole('alert');
});

it('keeps a trusted attachment on its own legacy identity even when both document-route capabilities are enabled',async()=>{
  mocks.get.mockResolvedValue(meta(true,true,true));mocks.open.mockRejectedValue(new Error('source sentinel'));
  const attachment={...buffer,file:{...buffer.file,ref:{...buffer.file.ref,id:'attachment-ref'},attachment:{kind:'attachment'}}} as unknown as FileBuffer;
  mount(attachment);await waitFor(()=>expect(mocks.open).toHaveBeenCalledOnce());expect(mocks.open.mock.calls[0][0].ref.id).toBe('attachment-ref');expect(screen.queryByTestId('popcorn')).toBeNull();await screen.findByRole('alert');
});

it('uses a successful policy refresh to select the actual ordinary route without relying on receiver or library presence',async()=>{
  mocks.get.mockResolvedValue(meta(true,true,false));const client=mount();await screen.findByTestId('popcorn');expect(mocks.open).not.toHaveBeenCalled();
  mocks.get.mockResolvedValue(meta(false,true,true));mocks.open.mockRejectedValue(new Error('source sentinel'));
  await client.invalidateQueries({queryKey:['appSettings','fileOffice','meta']});await waitFor(()=>expect(mocks.open).toHaveBeenCalledOnce());expect(screen.queryByTestId('popcorn')).toBeNull();await screen.findByRole('alert');
});
