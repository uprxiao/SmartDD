import { randomUUID } from 'node:crypto';
import { FileError } from '@shared/files';
import type { OfficeFidelityFailure, OfficeFidelityReport } from '@shared/file-office-fidelity';
import { OFFICE_LIMITS } from '@shared/file-office';

/** One bounded candidate per live owner/document, never renderer supplied.
 * Selection of a copy is independent of an original-file save acknowledgment. */
export class OfficeBlockedCandidate {
  private current?: { failure: OfficeFidelityFailure; bytes: Uint8Array };
  block(version: number, bytes: Uint8Array, report: OfficeFidelityReport): OfficeFidelityFailure {
    if(!bytes.byteLength||bytes.byteLength>OFFICE_LIMITS.outputBytes)throw new FileError('TOO_LARGE','Office 候选为空或超过 40 MiB；原件未改变');
    const failure = { ...report, token: randomUUID(), version };
    this.current = { failure, bytes }; return failure;
  }
  select(token: string, version: number): Uint8Array {
    if (!this.current || this.current.failure.token !== token || this.current.failure.version !== version) throw new FileError('CHANGED', '有损副本已过期，请重新保存并核对差异');
    return this.current.bytes;
  }
  clear(): void { this.current = undefined; }
}
