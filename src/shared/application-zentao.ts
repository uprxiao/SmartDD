import { z } from 'zod';
import type { ApplicationResourceRef } from './application-data';
export const zentaoSourceRefSchema=z.object({connectionId:z.uuid(),identityRevision:z.number().int().positive(),nativeId:z.string().regex(/^[0-9]{1,64}$/).refine(v=>!/^0+$/.test(v)),contentRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ZentaoSourceRef=z.infer<typeof zentaoSourceRefSchema>;
export interface ZentaoWorkData {kind:'bug'|'story';items:{id:string;title:string;status:string;assignedTo:string;reference:ZentaoSourceRef}[];total:number|null;nextCursor:string|null;complete:boolean;checkedAt:string;problems:{code:string;objectId:string|null}[];presentation?:ZentaoPresentation}
/** Optional UI view metadata. Never added to frozen Agent tool v1 outputs. */
export interface ZentaoPresentation {available:boolean;labels:Record<string,string>;choices:Record<string,Record<string,string>>}
export interface ZentaoDetailData {kind:'bug'|'story';id:string;reference:ZentaoSourceRef;fields:Record<string,unknown>;body:ApplicationResourceRef|null;history:ApplicationResourceRef|null;attachments:{filename:string;resource:ApplicationResourceRef}[];complete:boolean;missing:string[];presentation?:ZentaoPresentation}
export interface ZentaoWorkInput {kind:'bug'|'story';connectionId?:string|null;cursor?:string|null;limit?:number}
export interface ZentaoDetailInput {kind:'bug'|'story';reference:ZentaoSourceRef}
