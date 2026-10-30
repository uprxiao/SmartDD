export type SymlinkRaceVariant='target'|'parent-inside'|'parent-outside';
export const symlinkRaceVariants:SymlinkRaceVariant[];
export interface SymlinkRacePaths {base:string;root:string;outside:string;id:string;variant:SymlinkRaceVariant;parent:string;target:string;held:string;heldFile:string;link:string;linkTarget:string}
export function symlinkRacePaths(base:string,root:string,outside:string,id:string,variant:SymlinkRaceVariant):SymlinkRacePaths;
export function symlinkRaceBase(id:string):string;
export function symlinkRaceLocal(id:string):string;
export const symlinkRaceCanary:string;
