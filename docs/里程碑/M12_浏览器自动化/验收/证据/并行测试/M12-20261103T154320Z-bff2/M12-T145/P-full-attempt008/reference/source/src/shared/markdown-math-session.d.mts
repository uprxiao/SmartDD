export interface MarkdownMathFormula { source: string; displayMode: boolean }
export interface MarkdownMathResult { html: string[]; nodes: number; units: number; overflow: boolean }
export interface MarkdownMathSession { renderGroup(formulas: MarkdownMathFormula[], options: { signal: AbortSignal; baseNodes?: number; baseUnits?: number }): Promise<MarkdownMathResult>; dispose(): void }
export interface MarkdownMathBudget { reserve(owner: object, extra: number): boolean; release(owner: object): void }
export function createMarkdownMathSession(): MarkdownMathSession;
export function createMarkdownMathBudget(baseUnits: number): MarkdownMathBudget;
export function hydrateMarkdownMath(root: HTMLElement, session: MarkdownMathSession, signal: AbortSignal, options: { budget: MarkdownMathBudget; baseUnits?: number; measure?(): void; overflow?(): void; error?(error: unknown): void }): () => void;
