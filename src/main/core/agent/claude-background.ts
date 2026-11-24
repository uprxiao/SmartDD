/** A successful tool response can acknowledge a launch while the native task is still running. */
export function claudeBackgroundLaunch(kind: 'command' | 'subagent', result: unknown, output: string) {
  const fields = result as { isAsync?: unknown; status?: unknown; agentId?: unknown; backgroundTaskId?: unknown; stdout?: unknown; stderr?: unknown } | undefined;
  if (kind === 'subagent') {
    if (fields?.isAsync === true || fields?.status === 'async_launched')
      return { taskId: typeof fields.agentId === 'string' ? fields.agentId : undefined };
    if (fields?.isAsync === false || !output.startsWith('Async agent launched successfully.')) return;
    return { taskId: /^agentId:\s*([a-zA-Z0-9_-]+)\b/m.exec(output)?.[1] };
  }
  if (typeof fields?.backgroundTaskId === 'string' && fields.backgroundTaskId) return { taskId: fields.backgroundTaskId };
  if (typeof fields?.stdout === 'string' || typeof fields?.stderr === 'string') return;
  const taskId = /^Command running in background with ID:\s*([a-zA-Z0-9_-]+)\b/.exec(output)?.[1];
  return taskId ? { taskId } : undefined;
}
