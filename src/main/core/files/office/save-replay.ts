import { FileError, type FileCheckpointReceipt, type FileSaveReceipt } from '@shared/files';
import type { OfficeSaveInput } from '@shared/file-office';
import type { OfficeFidelityFailure } from '@shared/file-office-fidelity';

interface SavedOutcome { receipt: FileSaveReceipt; checkpoint?: FileCheckpointReceipt; draftError?: string; fidelity?: OfficeFidelityFailure }
/** Short, per-document replay window. Keep receipts, never large model states
 * or source bytes. Older/version-stale requests still face Worker/native guards. */
export class OfficeSaveReplay {
  private readonly outcomes = new Map<string, { intent: string; outcome: SavedOutcome }>();
  private intent(input: OfficeSaveInput): string {
    return JSON.stringify([input.id, input.version, input.draftId, input.bufferVersion]);
  }
  get(input: OfficeSaveInput): SavedOutcome | undefined {
    const previous = this.outcomes.get(input.opId);
    if (!previous) return undefined;
    if (previous.intent !== this.intent(input)) throw new FileError('IDEMPOTENCY', '此保存编号已用于另一份编辑或草稿');
    return previous.outcome;
  }
  remember(input: OfficeSaveInput, outcome: SavedOutcome): void {
    if (this.outcomes.size >= 128) this.outcomes.delete(this.outcomes.keys().next().value!);
    this.outcomes.set(input.opId, { intent: this.intent(input), outcome });
  }
}
