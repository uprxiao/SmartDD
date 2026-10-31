// @vitest-environment jsdom
import {useRef} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PptxElementMenu} from './pptx-menu';

function Host({prepare,enabled=true,busy=false}:{prepare:()=>Promise<boolean>;enabled?:boolean;busy?:boolean}) {
  const container=useRef<HTMLDivElement>(null);
  return <div ref={container}><PptxElementMenu enabled={enabled} busy={busy} container={container} onSelect={prepare} onLayer={()=>{}}><button>Layer target</button></PptxElementMenu></div>;
}
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function settle(){await act(async()=>{await new Promise<void>(done=>requestAnimationFrame(()=>done()));});}
it('W14 keeps all menu actions absent after preparation is explicitly rejected',async()=>{
  const prepare=vi.fn(async()=>false);render(<Host prepare={prepare}/>);
  fireEvent.contextMenu(screen.getByRole('button',{name:'Layer target'}),{button:2,clientX:20,clientY:20});
  await waitFor(()=>expect(prepare).toHaveBeenCalledOnce());await settle();
  expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
});
it('W14 waits for successful asynchronous selection preparation before exposing layer actions',async()=>{
  let accept!:(ok:boolean)=>void;const prepare=vi.fn(()=>new Promise<boolean>(resolve=>{accept=resolve}));render(<Host prepare={prepare}/>);
  fireEvent.contextMenu(screen.getByRole('button',{name:'Layer target'}),{button:2,clientX:20,clientY:20});
  await waitFor(()=>expect(prepare).toHaveBeenCalledOnce());await settle();expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  await act(async()=>{accept(true)});
  expect((await screen.findAllByRole('menuitem')).slice(0,4).map(item=>item.childNodes[0].textContent)).toEqual(['置于顶层','上移一层','下移一层','置于底层']);
});
it('W14 discards a late accepted preparation after editing permission is removed',async()=>{
  let accept!:(ok:boolean)=>void;const prepare=vi.fn(()=>new Promise<boolean>(resolve=>{accept=resolve}));const host=render(<Host prepare={prepare}/>);
  fireEvent.contextMenu(screen.getByRole('button',{name:'Layer target'}),{button:2,clientX:20,clientY:20});
  await waitFor(()=>expect(prepare).toHaveBeenCalledOnce());host.rerender(<Host prepare={prepare} enabled={false}/>);
  await act(async()=>{accept(true)});host.rerender(<Host prepare={prepare}/>);await settle();expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
});
it('W14 allows a successful input flush to finish its busy transition before opening',async()=>{
  let accept!:(ok:boolean)=>void;const prepare=vi.fn(()=>new Promise<boolean>(resolve=>{accept=resolve}));const host=render(<Host prepare={prepare}/>);
  fireEvent.contextMenu(screen.getByRole('button',{name:'Layer target'}),{button:2,clientX:20,clientY:20});
  await waitFor(()=>expect(prepare).toHaveBeenCalledOnce());host.rerender(<Host prepare={prepare} busy/>);await settle();expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  host.rerender(<Host prepare={prepare}/>);await act(async()=>{accept(true)});expect(await screen.findAllByRole('menuitem')).toHaveLength(4);
});
it('W14 leaves a rejected preparation closed without an unhandled promise rejection',async()=>{
  const prepare=vi.fn(async()=>{throw Error('Owned input preparation failed')});render(<Host prepare={prepare}/>);
  fireEvent.contextMenu(screen.getByRole('button',{name:'Layer target'}),{button:2,clientX:20,clientY:20});
  await waitFor(()=>expect(prepare).toHaveBeenCalledOnce());await settle();expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
});
it('W14 exposes exactly the four approved layer actions without an extra delete item',async()=>{
  render(<Host prepare={async()=>true}/>);fireEvent.contextMenu(screen.getByRole('button',{name:'Layer target'}),{button:2,clientX:20,clientY:20});
  expect((await screen.findAllByRole('menuitem')).map(item=>item.childNodes[0].textContent)).toEqual(['置于顶层','上移一层','下移一层','置于底层']);
});
