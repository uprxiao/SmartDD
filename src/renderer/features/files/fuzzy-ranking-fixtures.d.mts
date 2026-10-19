import type { FileFuzzyResult } from './file-fuzzy-model.mjs';
export interface FuzzyRankingFixture { id:string;caseId:string;query:string;candidates:string[];expected:Record<string,Partial<FileFuzzyResult>>;selectPath?:string;before?:string;after?:string;scopePrefix?:string;sortedLabels?:string[];stableName?:string;recentPath?:string }
export function fuzzyRankingFixtures():{files:Record<string,string>;cases:FuzzyRankingFixture[]};
export function verifyFuzzyFixture(scenario:FuzzyRankingFixture,ranked:({path:string;file_name:string}&FileFuzzyResult)[],providerPaths?:string[]):{scenario:string;caseId:string;checkedTargets:string[];rankedCount:number};
