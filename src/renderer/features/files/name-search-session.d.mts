import type {FileFuzzyResult} from './file-fuzzy-model.mjs';
type Candidate={path:string;file_name?:string;label?:string};
export function rankNameCandidates<T extends Candidate>(query:string,candidates:readonly T[],onUpdate?:(ranked:(T&FileFuzzyResult&{file_name:string})[])=>void):(T&FileFuzzyResult&{file_name:string})[];
