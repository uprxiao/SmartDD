export function blameLine(n:number,version?:string):string;
export function blameAuthor(n:number):string;
export function createBlameFixture():Promise<{scratch:string;project:string;path:string;original:string;indexHash:string;head:string;commits:string[];lineCount:number;other:string;boundary:string}>;
