export const NAME_RESULT_LIMIT: number;
export interface NameResultWindow<T> { ranked: T[]; total: number; truncated: boolean; limit: number }
export function limitNameResults<T>(ranked: readonly T[], limit?: number): NameResultWindow<T>;
export function nameResultNotice(result: Pick<NameResultWindow<unknown>, 'total' | 'truncated' | 'limit'> | null | undefined): string;
