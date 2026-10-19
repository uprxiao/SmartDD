export function createSaveFailureFixture(broker:string):Promise<{
 base:string;volume:string;project:string;wrapper:string;original:string;control:string;trace:string;evidence:Record<string,unknown>;
 activate(mode:'permission'|'disk-full'|'generic'):Promise<Record<string,unknown>>;
 clear():Promise<void>;cloneApp(app:string):Promise<string>;observations():Promise<Record<string,unknown>[]>;close():Promise<void>;
}>;
