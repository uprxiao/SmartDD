// @vitest-environment jsdom
import{cleanup,render}from'@testing-library/react';
import{afterEach,beforeEach,expect,it,vi}from'vitest';
import{TaskView}from'./task-view';
const state=vi.hoisted(()=>({navigation:{currentViewId:'home'},task:{id:'task-1',runtimeSnapshot:null,archivedAt:null as number|null},terminalSettings:{value:undefined},focus:vi.fn()}));
vi.mock('mobx-react-lite',()=>({observer:(component:unknown)=>component}));
vi.mock('@renderer/core/navigation',()=>({navigation:state.navigation}));
vi.mock('@renderer/core/tasks-store',()=>({tasksStore:{get current(){return state.task},terminals:new Map([['task-1','pty-1']]),get byId(){return new Map([['task-1',state.task]])}}}));
vi.mock('@renderer/lib/hooks/useAppSettingsKey',()=>({useAppSettingsKey:()=>state.terminalSettings}));
vi.mock('@renderer/lib/theme',()=>({useTheme:()=>({effectiveTheme:'ydark'})}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{app:{openExternal:vi.fn()}},events:{emit:vi.fn()}}));
vi.mock('@renderer/core/pty-buffer',()=>({attachPty:()=>()=>undefined}));
vi.mock('@renderer/features/files/terminal-context/store',()=>({FILE_TERMINAL_DRAG_TYPE:'test-file',registerFileTerminal:()=>()=>undefined,currentFileTerminal:()=>null,dropFileToTerminal:vi.fn()}));
vi.mock('@renderer/lib/i18n',()=>({default:{t:(key:string)=>key}}));
vi.mock('./task-archive',()=>({ArchivedTaskNotice:()=>null}));
vi.mock('./capabilities',()=>({InjectionFailure:()=>null}));
vi.mock('@xterm/addon-fit',()=>({FitAddon:class{fit(){}}}));
vi.mock('@xterm/addon-unicode11',()=>({Unicode11Addon:class{}}));
// A small xterm adapter gives the real TaskView effect a focusable terminal.
// It does not implement the policy under test or claim native App evidence.
vi.mock('@xterm/xterm',()=>({Terminal:class{
 textarea=document.createElement('textarea');unicode={activeVersion:'11'};options={};cols=80;rows=24;
 loadAddon(){}open(host:HTMLElement){this.textarea.dataset.testid='fake-terminal-input';host.append(this.textarea)}
 focus(){state.focus();this.textarea.focus()}attachCustomKeyEventHandler(){}onData(){return{dispose(){}}}hasSelection(){return false}dispose(){this.textarea.remove()}
}}));
beforeEach(()=>{state.navigation.currentViewId='home';state.task.archivedAt=null;state.focus.mockClear();vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}})});
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
const shell=(kind:string)=> <><div data-testid="file-workspace">{kind==='input'?<input aria-label="File filter"/>:kind==='textarea'?<textarea aria-label="Search"/>:kind==='editor'?<div contentEditable suppressContentEditableWarning>Editor</div>:kind==='file-button'?<button>File menu action</button>:null}</div>{kind==='dialog'?<div role="dialog"><input aria-label="Confirmation field"/></div>:kind==='menu'?<div role="menu"><button role="menuitem">Menu item</button></div>:kind==='navigation'?<button data-testid="task-navigation">Open task</button>:null}<TaskView/></>;
it.each(['input','textarea','editor','file-button','dialog','menu'])('preserves an existing %s focus when terminal becomes visible',kind=>{
 const mounted=render(shell(kind)),target=document.querySelector<HTMLElement>(kind==='input'?'[aria-label="File filter"]':kind==='textarea'?'[aria-label=Search]':kind==='editor'?'[contenteditable]':kind==='file-button'?'[data-testid=file-workspace] button':kind==='dialog'?'[aria-label="Confirmation field"]':'[role=menuitem]')!;
 target.focus();expect(document.activeElement).toBe(target);state.navigation.currentViewId='task';mounted.rerender(shell(kind));expect(document.activeElement).toBe(target);expect(state.focus).not.toHaveBeenCalled();
});
it('focuses a visible writable terminal when the document has no other owner',()=>{const mounted=render(shell('empty'));state.navigation.currentViewId='task';mounted.rerender(shell('empty'));expect(document.activeElement).toBe(document.querySelector('[data-testid=fake-terminal-input]'));expect(state.focus).toHaveBeenCalledTimes(1)});
it('preserves automatic focus for an explicit task navigation button',()=>{const mounted=render(shell('navigation'));document.querySelector<HTMLElement>('[data-testid=task-navigation]')!.focus();state.navigation.currentViewId='task';mounted.rerender(shell('navigation'));expect(document.activeElement).toBe(document.querySelector('[data-testid=fake-terminal-input]'));expect(state.focus).toHaveBeenCalledTimes(1)});
it('does not focus a hidden or archived read-only terminal',()=>{const mounted=render(shell('empty'));expect(state.focus).not.toHaveBeenCalled();state.task.archivedAt=1;state.navigation.currentViewId='task';mounted.rerender(shell('empty'));expect(state.focus).not.toHaveBeenCalled()});
it('does not refocus the previous terminal while a popup is establishing its focus',()=>{const mounted=render(shell('dialog'));document.querySelector<HTMLElement>('[data-testid=fake-terminal-input]')!.focus();state.navigation.currentViewId='task';mounted.rerender(shell('dialog'));expect(state.focus).not.toHaveBeenCalled()});
