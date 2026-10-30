export interface ReleasableSession { destroy(): Promise<void> }

/** Replacement waits for the previous native worker's bounded shutdown, even
 * when React unmounts one view and mounts another in the same commit. */
export class ViewerSessionSlot<T extends ReleasableSession> {
  private current: T | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  replace(create: () => Promise<T>, signal: AbortSignal): Promise<T> {
    const result = this.queue.catch(() => undefined).then(async () => {
      signal.throwIfAborted();
      await this.current?.destroy(); this.current = null;
      signal.throwIfAborted();
      const session = await create();
      if (signal.aborted) { await session.destroy(); signal.throwIfAborted(); }
      this.current = session;
      return session;
    });
    this.queue = result;
    return result;
  }
}
