import { z } from 'zod';
import { filePathSchema, fileScopeSchema, type FileScope } from './files';

/** Restore hints only. These paths never grant file access: opening a restored
 * route still requires a newly issued root lease and document capability. */
export const fileRouteSchema = z.object({
  source: z.enum(['project-directory', 'task-cwd']), sourceId: z.string().min(1).max(128),
  sourcePath: z.string().max(32768), relativePath: filePathSchema,
  mode: z.enum(['document', 'source']).default('document'),
  // Reading hints only. The document is reopened on a fresh capability and
  // the parser clamps page to its actual count; no bytes, passwords or URLs.
  pdf: z.object({ page: z.number().int().positive().safe(), zoom: z.number().min(30).max(800) }).strict().optional(),
  // Historical identity hints only: never authorize a remote source or merge
  // a nonlocal descriptor with the same-path local document.
  hostId: z.string().min(1).max(128).optional(), remotePath: z.string().max(32768).optional(),
}).strict();
export type FileRoute = z.infer<typeof fileRouteSchema>;
const sourceKey = z.string().max(33000);
export const fileWorkspaceSchema = z.object({
  schemaVersion: z.literal(1), routes: z.array(fileRouteSchema).max(200), active: fileRouteSchema.nullable(),
  treeSource: sourceKey.nullable(),
  expanded: z.record(sourceKey, z.array(filePathSchema).max(2000)),
  collapsedRoots: z.array(sourceKey).max(200).default([]),
  filters: z.record(sourceKey, z.string().max(256)).default({}),
  treeWidth: z.number().min(0).max(1600),
}).strict();
export type SavedFileWorkspace = z.infer<typeof fileWorkspaceSchema>;
export const workspaceSnapshotSchema = z.object({ revision: z.number().int().nonnegative().safe(), state: fileWorkspaceSchema.nullable() }).strict();
export type WorkspaceSnapshot = z.infer<typeof workspaceSnapshotSchema>;
export const workspaceUpdateSchema = workspaceSnapshotSchema.extend({ scope: fileScopeSchema, mutationId: z.string().uuid() });
export type WorkspaceUpdate = z.infer<typeof workspaceUpdateSchema>;
export type WorkspaceCommit = WorkspaceSnapshot & { accepted: boolean };
export interface WorkspacePersistence {
  load(scope: FileScope): Promise<SavedFileWorkspace | null>;
  save?(scope: FileScope, state: SavedFileWorkspace): Promise<void>;
  snapshot?(scope: FileScope): Promise<WorkspaceSnapshot>;
  commit?(scope: FileScope, state: SavedFileWorkspace, expectedRevision: number, mutationId: string): Promise<WorkspaceCommit>;
  subscribe?(listener: (update: WorkspaceUpdate) => void): () => void;
}
export const fileScopeKey = (scope: FileScope) => scope.kind === 'task' ? `task:${scope.taskId}` : `project:${scope.projectId}`;
export const WORKSPACE_STATE_BYTES = 4 * 1024 * 1024;
