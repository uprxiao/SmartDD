export const FILE_INLINE_DIFF_LIMITS:Readonly<{units:262144;lines:5000}>;
export interface FileInlineDiffPolicy {state:'none'|'enabled'|'too-large';reason:string}
export function fileInlineDiffPolicy(disk:string|null,local:string):FileInlineDiffPolicy;
