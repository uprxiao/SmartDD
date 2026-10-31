import type { OfficeClient } from './client';

export type WorkbookSourcePhase = 'starting' | 'live' | 'refreshing' | 'blocked' | 'fallback';
/** A view capability never grants file access. A live controller must belong to
 * the FileBuffer's current ref/revision; it cannot redirect the native writer. */
export type WorkbookSource = { kind: 'static' | 'local' } | {
  kind: 'artifactDocument'; key: string; phase: WorkbookSourcePhase;
  controller?: OfficeClient; message?: string;
};
export interface WorkbookHostOptions {
  source?: WorkbookSource;
  isEditing?: boolean;
  manualEditUiEnabled?: boolean;
  artifactSearchEnabled?: boolean;
  onArtifactSearch?(): void;
}
export interface ResolvedWorkbookHost {
  source: WorkbookSource;
  isEditing: boolean;
  manualEditUiEnabled: boolean;
  artifactSearchEnabled: boolean;
  onArtifactSearch?: () => void;
}
export const localWorkbookHost: Readonly<WorkbookHostOptions> = Object.freeze({
  source: Object.freeze({kind:'local' as const}), isEditing: true, manualEditUiEnabled: true,
});
/** The common host defaults remain restrictive. The FileBuffer-owned producer
 * derives its capabilities from the issued source and live controller. */
export function workbookHost(options: WorkbookHostOptions = {}): ResolvedWorkbookHost {
  return {
    source: options.source ? { ...options.source } : { kind: 'static' },
    isEditing: options.isEditing === true,
    manualEditUiEnabled: options.manualEditUiEnabled === true,
    artifactSearchEnabled: options.artifactSearchEnabled === true,
    onArtifactSearch: options.onArtifactSearch,
  };
}
export function workbookEditRequested(host: ResolvedWorkbookHost, liveController: boolean): boolean {
  return host.source.kind==='artifactDocument' ? host.source.phase==='live' && liveController : host.isEditing;
}
export function workbookSourceKey(source: WorkbookSource): string {
  return source.kind === 'artifactDocument' ? `artifact:${source.key}` : source.kind;
}
