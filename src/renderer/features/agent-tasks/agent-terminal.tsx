// 新任务的手动终端抽屉（照 T3 终端抽屉）：任务目录下的用户 shell，与 Agent 运行分离。
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ptyInputEvent, ptyResizeEvent } from '@shared/events';
import { APP_SETTINGS_DEFAULTS } from '@shared/app-settings';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { attachPty } from '@renderer/core/pty-buffer';
import { useAppSettingsKey } from '@renderer/lib/hooks/useAppSettingsKey';
import { events, rpc } from '@renderer/lib/ipc';

type OpenTerminal = {terminalKey: string; ptyId: string};

export function AgentTerminalDrawer({ taskId,home, onClose }: { taskId?: string;home?:{projectId:string;dirId:string}; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const active = useRef<{request: Promise<OpenTerminal>; closing: boolean} | null>(null);
  const closeDrawer = useRef(onClose);
  closeDrawer.current = onClose;
  const [terminal, setTerminal] = useState<OpenTerminal | null>(null);
  const [closing, setClosing] = useState(false);
  const {projectId, dirId} = home ?? {};
  const surface = useRef<{ term: Terminal; resize: () => void } | null>(null);
  const binding = useRef<OpenTerminal | null>(null);
  const { value: settings = APP_SETTINGS_DEFAULTS.terminal } = useAppSettingsKey('terminal');
  const fontFamily = `'WillYou Powerline', ${settings.fontFamily}`;
  const font = useRef({ fontFamily, fontSize: settings.fontSize });
  font.current = { fontFamily, fontSize: settings.fontSize };

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const term = new Terminal({ scrollback: 5000, convertEol: false, ...font.current, allowProposedApi: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(node);
    const applyTheme = () => {
      const style = getComputedStyle(node);
      const color = (name: string) => style.getPropertyValue(`--xterm-${name}`).trim() || undefined;
      term.options.theme = {
        background: color('bg'), foreground: color('fg'), cursor: color('cursor'),
        cursorAccent: color('cursor-accent'), selectionBackground: color('selection-bg'),
        selectionForeground: color('selection-fg'),
      };
    };
    applyTheme();
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    let sent: { ptyId: string; cols: number; rows: number } | undefined;
    const resize = () => {
      // FitAddon otherwise picks a 2×1 grid when the containing split is hidden.
      if (!node.clientWidth || !node.clientHeight) return;
      fit.fit();
      const target = binding.current;
      if (!target || (sent?.ptyId === target.ptyId && sent.cols === term.cols && sent.rows === term.rows)) return;
      sent = { ptyId: target.ptyId, cols: term.cols, rows: term.rows };
      events.emit(ptyResizeEvent, { taskId: target.terminalKey, ...sent });
    };
    surface.current = { term, resize };
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => { themeObserver.disconnect(); observer.disconnect(); surface.current = null; term.dispose(); };
  }, []);

  useEffect(() => {
    const current = surface.current;
    if (!current) return;
    current.term.options = { fontFamily, fontSize: settings.fontSize };
    current.resize();
  }, [fontFamily, settings.fontSize]);

  useEffect(() => {
    surface.current?.term.reset();
    const size = {cols:120, rows:14};
    const request = taskId
      ? rpc.agentTasks.openTerminal(taskId, size).then(result => ({...result, terminalKey:taskId}))
      : projectId && dirId
        ? rpc.agentTasks.openHomeTerminal(projectId, dirId, size)
        : Promise.reject(Error('先选择项目目录'));
    const attempt = {request, closing:false};
    active.current = attempt;
    setTerminal(null);
    setClosing(false);
    void request.then(result => {
      if (active.current === attempt && !attempt.closing) setTerminal(result);
    }, error => {
      if (active.current !== attempt || attempt.closing) return;
      toast.error(rpcErrorMessage(error));
      closeDrawer.current();
    });
    return () => { active.current = null; };
  }, [taskId, projectId, dirId]);
  const close = async () => {
    const attempt = active.current;
    if (!attempt || attempt.closing) return;
    attempt.closing = true;
    setClosing(true);
    const result = await attempt.request.catch(() => null);
    try {
      if (result) await rpc.agentTasks.closeTerminal(result.terminalKey);
      if (active.current === attempt) closeDrawer.current();
    } catch (error) {
      if (active.current === attempt) {
        setTerminal(result);
        toast.error(rpcErrorMessage(error));
      }
    } finally {
      attempt.closing = false;
      if (active.current === attempt) setClosing(false);
    }
  };
  useEffect(() => {
    if (!terminal || !surface.current) return;
    const {terminalKey, ptyId} = terminal;
    const {term, resize} = surface.current;
    binding.current = terminal;
    term.reset();
    resize();
    const offInput = term.onData(data => events.emit(ptyInputEvent, { taskId:terminalKey, ptyId, data }));
    const detach = attachPty(ptyId, { data: d => term.write(d), exit: code => term.write(`\r\n[shell 已退出 ${code}]\r\n`) });
    if (host.current?.getClientRects().length) term.focus();
    return () => { binding.current = null; detach(); offInput.dispose(); };
  }, [terminal]);
  return <div className="agent-terminal" data-testid="agent-terminal">
    <div className="agent-terminal-head"><span>终端 · 手动</span><button type="button" title="关闭终端" disabled={closing} onClick={() => void close()}><X size={13} /></button></div>
    <div className="agent-terminal-host">
      <div className="agent-terminal-surface" ref={host} />
      {!terminal && <span className="agent-terminal-opening" role="status">正在连接终端…</span>}
    </div>
  </div>;
}
