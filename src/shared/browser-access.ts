export type BrowserAccessMode='observe'|'control';
export interface BrowserAccessRequest {
  id:string;runId:string;projectId:string;requesterTaskId:string;targetTaskId:string;
  mode:BrowserAccessMode;requestedMode:BrowserAccessMode;createdAt:number;expiresAt:number;requestId?:string;
}
export interface BrowserAccessGrant extends Omit<BrowserAccessRequest,'expiresAt'> {grantedAt:number}
export interface BrowserAccessState {requests:BrowserAccessRequest[];grants:BrowserAccessGrant[]}
