import type { OfficePagesInfo } from '@shared/file-office-pages';
import { OfficeWorkerClient } from './worker-client';
export class OfficePagesParser extends OfficeWorkerClient {
  inspect(bytes:Uint8Array,hash:string,signal:AbortSignal):Promise<OfficePagesInfo>{return this.request({method:'inspect',bytes,hash},signal);}
  prepare(bytes:Uint8Array,hash:string,signal:AbortSignal):Promise<{info:OfficePagesInfo;previewBytes?:Uint8Array}>{return this.request({method:'prepare',bytes,hash},signal);}
}
