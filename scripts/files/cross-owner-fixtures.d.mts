export interface CrossOwnerCapability {root:{lease:string;generation:number};ref:{id:string;lease:string;generation:number};hash:string;draftId:string;draftHash:string;draftVersion:number}
export function crossOwnerRequests(peer:CrossOwnerCapability,ownRoot:CrossOwnerCapability['root']):Array<[string,unknown[]]>;
