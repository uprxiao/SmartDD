export interface MarkdownMathOptions { displayMode: boolean; strict: 'ignore'; throwOnError: false; trust: false; maxExpand: 1000; maxSize: 100 }
export function markdownMathOptions(displayMode: boolean): MarkdownMathOptions;
export function installDollarMath(md: any): void;
