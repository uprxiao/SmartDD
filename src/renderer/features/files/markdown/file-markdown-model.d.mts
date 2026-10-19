export function renderMarkdownReadOnly(text: string, mathRender?: (source: string, displayMode: boolean) => string): string;
export function parseMarkdown(source: string): any;
export function renderMarkdownBlock(block: any, env?: any): string;
export function highlightedCode(block: any): any;
export function codeBody(block: any): string;
export function parseFrontmatter(source: string): any;
