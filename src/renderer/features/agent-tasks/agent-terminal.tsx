// 新任务的手动终端抽屉（照 T3 终端抽屉）：任务目录下的用户 shell，与 Agent 运行分离。
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ptyInputEvent, ptyResizeEvent } from '@shared/events';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { attachPty } from '@renderer/core/pty-buffer';
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
  useEffect(() => {
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
    if (!terminal || !host.current) return;
    const {terminalKey, ptyId} = terminal;
    const term = new Terminal({ scrollback: 5000, convertEol: false, fontSize: 12.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', allowProposedApi: true });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current);
    const resize = () => { try { fit.fit(); events.emit(ptyResizeEvent, { taskId:terminalKey, ptyId, cols: term.cols, rows: term.rows }); } catch { /* 隐藏时不可测量 */ } };
    resize();
    const offInput = term.onData(data => events.emit(ptyInputEvent, { taskId:terminalKey, ptyId, data }));
    const detach = attachPty(ptyId, { data: d => term.write(d), exit: code => term.write(`\r\n[shell 已退出 ${code}]\r\n`) });
    const ro = new ResizeObserver(resize); ro.observe(host.current);
    term.focus();
    return () => { ro.disconnect(); detach(); offInput.dispose(); term.dispose(); };
  }, [terminal]);
  return <div className="agent-terminal" data-testid="agent-terminal">
    <div className="agent-terminal-head"><span>终端 · 手动</span><button type="button" title="关闭终端" disabled={closing} onClick={() => void close()}><X size={13} /></button></div>
    <div className="agent-terminal-host" ref={host} />
  </div>;
}
