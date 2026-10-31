export type ProjectCapabilitySetting = {
  id: string;
  projectId: string;
  capabilityId: string;
  enabled: boolean | 0 | 1;
};

export const projectCapabilitySettingId = (projectId: string, capabilityId: string): string => `${projectId}:${capabilityId}`;

/** Older imports used random row IDs. An explicit later setting takes precedence. */
export function projectCapabilityEnabled(rows: readonly ProjectCapabilitySetting[], projectId: string, capabilityId: string): boolean {
  const matching = rows.filter(row => row.projectId === projectId && row.capabilityId === capabilityId);
  const explicit = matching.find(row => row.id === projectCapabilitySettingId(projectId, capabilityId));
  // Absence retains the standard defaults; conflicting legacy rows cannot turn a disabled capability on.
  return explicit ? Boolean(explicit.enabled) : matching.every(row => Boolean(row.enabled));
}
