export interface CaseVolumePaths {kind:string;slot:string;sensitive:boolean;root:string;inner:string;alias:string}
export function caseVolumeBase(slot:string,name:string):string;
export function caseVolumeLocal(slot:string,name:string):string;
export function createCaseVolumeFixture():Promise<{base:string;evidence:{at:string;base:string;volumes:Array<{kind:string;format:string;sensitive:boolean;mount:string;image:string;device:string;mountedDevice:number;capacityBytes:number;detached:boolean;actualProbe?:unknown}>;commands:unknown[];cases:CaseVolumePaths[];boundary:string};prepare(kind:string,slot:string):Promise<CaseVolumePaths>;close():Promise<void>}>;
