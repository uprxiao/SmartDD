import type { AiProfileView } from '@shared/ai-profiles';

type Candidate = Pick<AiProfileView, 'id' | 'isDefault' | 'check' | 'checking'>;

/** Untested or still-checking profiles count as usable: at startup most are, and skipping them would hide the default. */
const usable = (p: Candidate | undefined) => (p && (p.checking || p.check?.status !== 'failed') ? p : undefined);

/** Home composer profile: the default, then the last choice, then the first usable one; the default when none is usable. */
export function pickLaunchProfile(profiles: readonly Candidate[], lastId: string | null | undefined): string | null {
  const fallback = profiles.find((p) => p.isDefault);
  const last = profiles.find((p) => p.id === lastId);
  return (usable(fallback) ?? usable(last) ?? profiles.find((p) => usable(p)) ?? fallback ?? last)?.id ?? null;
}
