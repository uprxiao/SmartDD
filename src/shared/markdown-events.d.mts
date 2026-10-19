export function markdownLinkAllowed(event: Pick<MouseEvent, 'button' | 'detail' | 'shiftKey'>, options?: { editorEmpty?: boolean; nativeSelected?: boolean }): boolean;
export function markdownNativeSelection(root: HTMLElement, selection?: Selection | null): boolean;
export function waitMarkdownMouseup(document: Document, options: { signal?: AbortSignal; isCurrent(): boolean; finish(event: MouseEvent): void; settled?(): void }): () => void;
