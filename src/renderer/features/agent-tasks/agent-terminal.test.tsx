// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({open:vi.fn(), close:vi.fn(), emit:vi.fn(), fit:vi.fn()}));
vi.mock('@renderer/lib/ipc', () => ({
  rpc:{agentTasks:{openHomeTerminal:mocks.open, closeTerminal:mocks.close}}, events:{emit:mocks.emit},
}));
vi.mock('@renderer/core/pty-buffer', () => ({attachPty:() => () => {}}));
vi.mock('@renderer/lib/hooks/useAppSettingsKey', () => ({useAppSettingsKey: () => ({})}));
vi.mock('@xterm/xterm', () => ({Terminal:class {
  options = {};
  cols = 80;
  rows = 24;
  loadAddon() {} open() {} focus() {} dispose() {} reset() {}
  onData() { return {dispose() {}}; }
}}));
vi.mock('@xterm/addon-fit', () => ({FitAddon:class { fit() { mocks.fit(); } }}));
import {AgentTerminalDrawer} from './agent-terminal';

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('A73 closes the home shell after its pending startup supplies the terminal key', async () => {
  let completeOpen!: (value:{terminalKey:string;ptyId:string}) => void;
  mocks.open.mockImplementationOnce(() => new Promise(resolve => { completeOpen = resolve; }));
  mocks.close.mockResolvedValueOnce(undefined);
  const onClose = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  render(<AgentTerminalDrawer home={{projectId:'project',dirId:'dir'}} onClose={onClose} />);
  expect(screen.getByRole('status').textContent).toBe('正在连接终端…');
  const close = screen.getByRole('button', {name:'关闭终端'});
  fireEvent.click(close);
  fireEvent.click(close);
  expect(mocks.close).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => completeOpen({terminalKey:'home-shell-key',ptyId:'pty'}));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(mocks.close.mock.calls).toEqual([['home-shell-key']]);
});

it('A73 keeps the PTY size while the workspace split is hidden', async () => {
  mocks.open.mockResolvedValueOnce({terminalKey:'home-shell-key',ptyId:'pty'});
  let notifyResize!: () => void;
  let width = 0;
  vi.stubGlobal('ResizeObserver', class {
    constructor(resize: () => void) { notifyResize = resize; }
    observe() {} disconnect() {}
  });
  const {container} = render(<AgentTerminalDrawer home={{projectId:'project',dirId:'dir'}} onClose={vi.fn()} />);
  const surface = container.querySelector('.agent-terminal-surface')!;
  Object.defineProperties(surface, { clientWidth: {get: () => width}, clientHeight: {get: () => width ? 240 : 0} });
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(mocks.emit).not.toHaveBeenCalled();
  width = 640;
  notifyResize();
  expect(mocks.emit).toHaveBeenCalledTimes(1);
  expect(mocks.fit).toHaveBeenCalledTimes(1);
  width = 0;
  notifyResize();
  expect(mocks.fit).toHaveBeenCalledTimes(1);
  width = 640;
  notifyResize();
  expect(mocks.fit).toHaveBeenCalledTimes(2);
  expect(mocks.emit).toHaveBeenCalledTimes(1);
});
