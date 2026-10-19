export const authorityFixtureFiles:Record<string,string>;
export const authorityLegalPath:string;
export function authorityRejectedPaths(outside:string):Array<{path:string;error:string}>;
export function authorityForgedScopes(projectId:string,foreignDirectoryId:string,outside:string):Array<{scope:Record<string,string>;error:string}>;
