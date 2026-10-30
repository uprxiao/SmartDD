export const REVIEW_TEXT_LIMIT: number;
export const REVIEW_TEXT_PAGE_BYTES: number;
export function reviewTextVerdict(kind: string, size: number): 'unsupported' | 'invalid' | 'too-large' | 'readable';
export interface ReviewTextInfo { bytes: number; pages: number }
export interface ReviewTextWindow { index: number; start: number; end: number; text: string; total: number; pages: number }
export class ReviewTextModel {
  constructor(bytes: Uint8Array);
  readonly info: ReviewTextInfo;
  window(index: number): ReviewTextWindow;
}
