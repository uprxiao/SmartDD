import { z } from 'zod';
import type { FileRevision, FileScope } from './files';

export const fileRecoveryInspectionSchema = z.object({
  projectKey: z.string().regex(/^[a-f0-9]{64}$/), id: z.string().uuid(), requestId: z.string().uuid(),
}).strict();
export type FileRecoveryInspectionInput = z.infer<typeof fileRecoveryInspectionSchema>;
export interface FileRecoveryItem {
  id: string; projectKey: string; state: string; message?: string; relativePath?: string;
  source?: { kind: 'project-directory' | 'task-cwd'; id: string; scope: FileScope };
  createdAt?: number; sourceAvailable?: boolean;
}
export type FileRecoveryMaterialKind = 'current' | 'displaced' | 'draft' | 'materialized';
export interface FileRecoveryMaterial {
  kind: FileRecoveryMaterialKind; available: boolean; revision?: FileRevision;
  preview?: string | null; truncated?: boolean; changed?: boolean; message?: string;
}
export interface FileRecoveryInspection {
  item: FileRecoveryItem; state: string; readOnly: true; materials: FileRecoveryMaterial[];
}
