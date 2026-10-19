export type SaveWriterMode='old-fd'|'path-inplace'|'path-replace';
export interface SaveWriterBatch {
 release():Promise<void>;
 finishSync():Array<Record<string,any>>;
 wait():Promise<{directory:string;gate:string;writers:Array<Record<string,any>>}>;
 evidence():{directory:string;gate:string;writers:Array<Record<string,any>>};
 cancel():Promise<void>;
}
export function prepareSaveWriters(base:string,target:string,specifications:Array<{mode:SaveWriterMode;text:string}>):Promise<SaveWriterBatch>;
