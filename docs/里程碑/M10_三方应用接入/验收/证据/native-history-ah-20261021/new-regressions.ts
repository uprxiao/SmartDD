

describe('persisted native history cannot become a fresh empty-root session', () => {
  it.each(['claude', 'codex'] as const)('rejects %s after observed history is removed and the host restarts', async (runner) => {
    const p = project();
    const profile = runner === 'claude' ? claudeProfile() : codexProfile();
    const created = await svc.create({ projectId: p.id, dirId: null, aiProfileId: profile.id, firstMessage: 'history guard' });
    if (runner === 'claude') {
      writeClaudeSession(created.task.cwd, created.task.id);
      appendFileSync(claudeSessionPath(created.task.cwd, created.task.id), JSON.stringify({ type: 'assistant', message: { model: 'synthetic', content: [{ type: 'text', text: 'native history written' }] } }) + '\n');
    } else {
      const file = writeCodexRollout(created.task.cwd, 'history-guard-native', clock);
      appendFileSync(file, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [] } }) + '\n');
      await vi.waitFor(() => expect(svc.get(created.task.id).nativeSessionId).toBe('history-guard-native'), { timeout: 2000 });
    }
    await vi.waitFor(() => expect(reports.some(r => r.ev.category === 'ok')).toBe(true), { timeout: 2000 });
    ptys.emit('exit', created.ptyId, 0);
    const before = sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(created.task.id);
    svc.dispose();
    const root = runner === 'claude' ? claudeRoot() : codexRoot();
    rmSync(root, { recursive: true });
    mkdirSync(root);
    svc = new TaskService({ db: drizzle(sqlite, { schema }), ptys, profiles, projects, baseEnv: () => ({ PATH: '/usr/bin', HOME: '/home/x' }), onChanged: () => changed++, now: () => ++clock, codexPollMs: 20, healthPollMs: 20 });
    const spawns = ptys.spawned.length;
    await expect(svc.open({ taskId: created.task.id })).rejects.toThrow(/原生会话.*(缺失|不可用)/);
    expect(ptys.spawned).toHaveLength(spawns);
    expect(sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(created.task.id)).toEqual(before);
  });
});
