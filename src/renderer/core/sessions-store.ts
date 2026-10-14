import { makeAutoObservable, runInAction } from 'mobx';
import { sessionUpdatedEvent } from '@shared/events';
import type { LaunchRequest, SessionRecord } from '@shared/types';
import { events, rpc } from '@renderer/lib/ipc';
import { navigation } from './navigation';

class SessionsStore {
  sessions: SessionRecord[] = [];
  /** The PTY shown in the terminal view; one at a time in M1, as in M0. */
  activePtyId: string | null = null;
  activeSessionId: string | null = null;

  constructor() {
    makeAutoObservable(this);
    events.on(sessionUpdatedEvent, () => void this.refresh());
  }

  async refresh(): Promise<void> {
    const list = await rpc.sessions.list();
    runInAction(() => (this.sessions = list));
  }

  /** Throws on failure so the caller can show the error where the user acted. */
  async launch(req: LaunchRequest): Promise<void> {
    if (this.activePtyId) await rpc.pty.kill(this.activePtyId);
    const res = await rpc.sessions.launch(req);
    runInAction(() => {
      this.activePtyId = res.ptyId;
      this.activeSessionId = res.session.id;
    });
    navigation.navigate('terminal');
    await this.refresh();
  }
}

export const sessionsStore = new SessionsStore();
