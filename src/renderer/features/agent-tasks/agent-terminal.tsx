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

export function AgentTerminalDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [ptyId, setPtyId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void rpc.agentTasks.openTerminal(taskId, { cols: 120, rows: 14 }).then(r => { if (alive) setPtyId(r.ptyId); }).catch(e => { toast.error(rpcErrorMessage(e)); onClose(); });
    return () => { alive = false; };
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ptyId || !host.current) return;
    const term = new Terminal({ scrollback: 5000, convertEol: false, fontSize: 12.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', allowProposedApi: true });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current);
    const resize = () => { try { fit.fit(); events.emit(ptyResizeEvent, { taskId, ptyId, cols: term.cols, rows: term.rows }); } catch { /* 隐藏时不可测量 */ } };
    resize();
    const offInput = term.onData(data => events.emit(ptyInputEvent, { taskId, ptyId, data }));
    const detach = attachPty(ptyId, { data: d => term.write(d), exit: code => term.write(`\r\n[shell 已退出 ${code}]\r\n`) });
    const ro = new ResizeObserver(resize); ro.observe(host.current);
    term.focus();
    return () => { ro.disconnect(); detach(); offInput.dispose(); term.dispose(); };
  }, [taskId, ptyId]);
  return <div className="agent-terminal" data-testid="agent-terminal">
    <div className="agent-terminal-head"><span>终端 · 手动</span><button type="button" title="关闭终端" onClick={() => { void rpc.agentTasks.closeTerminal(taskId); onClose(); }}><X size={13} /></button></div>
    <div className="agent-terminal-host" ref={host} />
  </div>;
}
