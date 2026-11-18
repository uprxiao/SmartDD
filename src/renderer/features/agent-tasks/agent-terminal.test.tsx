// @vitest-environment jsdom
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({open:vi.fn(), close:vi.fn()}));
vi.mock('@renderer/lib/ipc', () => ({
  rpc:{agentTasks:{openHomeTerminal:mocks.open, closeTerminal:mocks.close}}, events:{emit:vi.fn()},
}));
vi.mock('@renderer/core/pty-buffer', () => ({attachPty:() => () => {}}));
vi.mock('@xterm/xterm', () => ({Terminal:class {
  loadAddon() {} open() {} focus() {} dispose() {}
  onData() { return {dispose() {}}; }
}}));
vi.mock('@xterm/addon-fit', () => ({FitAddon:class { fit() {} }}));
import {AgentTerminalDrawer} from './agent-terminal';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('A73 closes the home shell after its pending startup supplies the terminal key', async () => {
  let completeOpen!: (value:{terminalKey:string;ptyId:string}) => void;
  mocks.open.mockImplementationOnce(() => new Promise(resolve => { completeOpen = resolve; }));
  mocks.close.mockResolvedValueOnce(undefined);
  const onClose = vi.fn();
  render(<AgentTerminalDrawer home={{projectId:'project',dirId:'dir'}} onClose={onClose} />);
  const close = screen.getByRole('button', {name:'关闭终端'});
  fireEvent.click(close);
  fireEvent.click(close);
  expect(mocks.close).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => completeOpen({terminalKey:'home-shell-key',ptyId:'pty'}));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(mocks.close.mock.calls).toEqual([['home-shell-key']]);
});
