export interface ImageMenuAction { id: string; label: string; value?: string }
export function imageMenuActions(input: { src?: string; displaySrc?: string; localPath?: string; host?: string; originHost?: string; animated?: boolean; canSelect?: boolean; canCopy?: boolean; clipboard?: boolean }): ImageMenuAction[];
export function markdownImageMenuAllowed(scope: string, hasContext: boolean): boolean;
