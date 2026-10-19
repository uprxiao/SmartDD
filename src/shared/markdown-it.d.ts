// Minimal typed surface used by this project's JS-parser boundary tests.
// Runtime is pinned markdown-it14.1.0; the adapter itself remains in .mjs.
declare module 'markdown-it' {
  export interface Token { type: string; tag: string; markup: string; map: [number, number] | null; info: string; content: string; children: Token[] | null }
  export default class MarkdownIt {
    constructor(options?: Record<string, unknown>);
    use(plugin: (...args: any[]) => unknown, ...options: unknown[]): this;
    parse(source: string, env?: Record<string, unknown>): Token[];
    render(source: string, env?: Record<string, unknown>): string;
  }
}
