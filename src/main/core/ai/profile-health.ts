import type { AiProfileView, ProfileCheck, ProfileCheckCategory, ProfileCheckSource } from '@shared/ai-profiles';
import type { AiProfilesChange } from '@shared/events';
import { redact } from '../connections/redact';
import type { AiProfileService } from './ai-profile-service';
import type { HealthEvent } from './health-classify';
import { runProfileTest, type ProfileTestResult } from './profile-tester';

export interface ProfileHealthDeps {
  profiles: AiProfileService;
  baseEnv: () => Record<string, string>;
  onChanged: (change: AiProfilesChange) => void;
  runTest?: typeof runProfileTest;
  now?: () => number;
}

/** A task's ok is written again only after this long, so a busy session does not rewrite the row per reply. */
export const OK_REFRESH_MS = 10 * 60_000;
/** The same error from the same task within this window is the same event. */
const SAME_EVENT_MS = 60_000;

/**
 * The profile's health: tests on demand (manual) or after import / create / a launch-affecting
 * edit (auto), and API answers seen in running tasks. Whatever happened last is what is stored.
 */
export class ProfileHealth {
  private readonly inFlight = new Map<string, { signature: string; promise: Promise<ProfileCheck | null> }>();
  private readonly now: () => number;

  constructor(private readonly d: ProfileHealthDeps) {
    this.now = d.now ?? Date.now;
  }

  isChecking(id: string): boolean {
    return this.inFlight.has(id);
  }

  withChecking(view: AiProfileView): AiProfileView {
    return { ...view, checking: this.isChecking(view.id) };
  }

  /**
   * One test per profile at a time: a second request for the same launch settings joins the
   * running one; after an edit it waits for it and then tests the new settings.
   */
  test(id: string, source: 'manual' | 'auto'): Promise<ProfileCheck | null> {
    const signature = this.d.profiles.launchSignature(id);
    const running = this.inFlight.get(id);
    if (running) {
      if (running.signature === signature) return running.promise;
      return running.promise.then(() => this.test(id, source));
    }
    const p = (async () => {
      let result: ProfileTestResult;
      try {
        const profile = this.d.profiles.resolve(id, true);
        result = await (this.d.runTest ?? runProfileTest)(profile, this.d.profiles.secretValues(id), { baseEnv: this.d.baseEnv() });
      } catch (e) {
        // A missing token stops a task the same way, so it is the profile's state too.
        result = { category: 'config', message: (e as Error).message, ms: 0 };
      }
      // Edited while the test ran: the result belongs to settings that no longer exist.
      if (this.d.profiles.launchSignature(id) !== signature) return null;
      return this.store(id, result.category, source, result.message, result.ms, true);
    })().finally(() => {
      this.inFlight.delete(id);
      this.d.onChanged({});
    });
    this.inFlight.set(id, { signature, promise: p });
    this.d.onChanged({});
    return p;
  }

  testInBackground(id: string, source: 'manual' | 'auto'): void {
    void this.test(id, source).catch(() => undefined);
  }

  /**
   * An answer seen in a running task's session file. `signature` is the profile's launch
   * signature when the task started: a task still running on settings edited since is ignored.
   */
  report(profileId: string, ev: HealthEvent, source: `task:${string}`, signature?: string): void {
    const prev = this.d.profiles.checkOf(profileId);
    const message = this.scrub(profileId, ev.message);
    if (prev) {
      const age = this.now() - prev.at;
      if (ev.category === 'ok' && prev.status === 'ok' && age < OK_REFRESH_MS) return;
      if (prev.category === ev.category && prev.message === message && prev.source === source && age < SAME_EVENT_MS) return;
    }
    if (signature && signature !== this.d.profiles.launchSignature(profileId)) return;
    this.store(profileId, ev.category, source, message, null, false);
  }

  private scrub(id: string, message: string): string {
    return redact(message, this.d.profiles.secretValues(id));
  }

  private store(
    id: string,
    category: ProfileCheckCategory,
    source: ProfileCheckSource,
    message: string,
    ms: number | null,
    quiet: boolean
  ): ProfileCheck | null {
    // Every path into the row and the UI goes through here: the profile's tokens never do.
    message = this.scrub(id, message);
    const prev = this.d.profiles.checkOf(id);
    const check = this.d.profiles.recordCheck(id, { category, source, message, ms });
    if (!check) return null;
    // A test notifies when it ends (finally above); tell the user only about a new failure they did not ask for.
    const failed = check.status === 'failed' && prev?.status !== 'failed' && source !== 'manual';
    if (failed) this.d.onChanged({ failed: { profileId: id, name: this.d.profiles.get(id).name, source, message } });
    else if (!quiet) this.d.onChanged({});
    return check;
  }
}
