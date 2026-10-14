import { useCallback, useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import type { ProbeResult, Runner, SessionRecord } from '@shared/types';

const api = window.smartdd;

export function App() {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [runner, setRunner] = useState<Runner>('claude');
  const [cwd, setCwd] = useState('');
  const [error, setError] = useState('');
  const [probes, setProbes] = useState<ProbeResult[] | null>(null);
  const termEl = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const activePty = useRef<string | null>(null);

  const refresh = useCallback(() => api.listSessions().then(setSessions), []);

  useEffect(() => {
    const t = new Terminal({ fontFamily: 'Menlo, monospace', fontSize: 13, cursorBlink: true });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(termEl.current!);
    f.fit();
    term.current = t;
    fit.current = f;
    t.onData((d) => activePty.current && api.write(activePty.current, d));
    const onResize = () => {
      f.fit();
      if (activePty.current) api.resize(activePty.current, t.cols, t.rows);
    };
    window.addEventListener('resize', onResize);
    const offData = api.onData((id, d) => id === activePty.current && t.write(d));
    const offExit = api.onExit((id, code) => {
      if (id === activePty.current) t.write(`\r\n[进程已退出，code=${code}]\r\n`);
    });
    const offUpd = api.onSessionUpdated(() => refresh());
    refresh();
    return () => {
      window.removeEventListener('resize', onResize);
      offData();
      offExit();
      offUpd();
      t.dispose();
    };
  }, [refresh]);

  const launch = async (r: Runner, dir: string, resumeSessionId?: string) => {
    setError('');
    try {
      if (activePty.current) api.kill(activePty.current);
      term.current?.reset();
      const res = await api.launch({ runner: r, cwd: dir, resumeSessionId });
      activePty.current = res.ptyId;
      const t = term.current!;
      api.resize(res.ptyId, t.cols, t.rows);
      t.focus();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <h3>新建会话</h3>
        <select value={runner} onChange={(e) => setRunner(e.target.value as Runner)}>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
        <input placeholder="代码目录（绝对路径）" value={cwd} onChange={(e) => setCwd(e.target.value)} />
        <button disabled={!cwd} onClick={() => launch(runner, cwd)}>
          启动
        </button>
        {error && <div className="error">{error}</div>}
        <button onClick={() => api.runProbes().then(setProbes)}>运行探针</button>
        <h3>会话（点击恢复）</h3>
        {sessions.map((s) => (
          <div
            key={s.id}
            className="session"
            title={s.nativeSessionId ? '恢复该会话' : '尚未拿到原生会话 ID，无法恢复'}
            onClick={() => s.nativeSessionId && launch(s.runner, s.cwd, s.nativeSessionId)}
          >
            {s.title}
            <small>{s.cwd}</small>
            <small>{s.nativeSessionId ?? '等待会话 ID…'}</small>
          </div>
        ))}
      </aside>
      <main className="main">
        <div className="terminal" ref={termEl} />
        {probes && (
          <div className="probes">
            {probes.map((p) => (
              <div key={p.name}>
                <span className={p.ok ? 'ok' : 'fail'}>{p.ok ? '✔' : '✘'}</span> {p.name}：{p.detail}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
