export const EDIT_BYTES: number;
export const READ_BYTES: number;
export const textSizeCases: { id: string; caseId: string; bytes: number }[];
export function exactUtf8Text(size: number, bom?: boolean): Buffer;
export function textSizeMetadata(bytes: Buffer): { bytes: number; units: number; editable: boolean; readable: boolean };
