import {z} from 'zod';
import {applicationIdSchema,type ApplicationId,type ApplicationProvider} from './application-connections';
const revision=z.number().int().nonnegative();
export const applicationImpactQuerySchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('switch'),appId:applicationIdSchema.optional(),projectId:z.string().min(1).max(128),expectedRevision:revision}).strict(),
 z.object({kind:z.literal('disconnect'),connectionId:z.uuid(),expectedRevision:revision}).strict(),
 z.object({kind:z.literal('remove'),appId:applicationIdSchema,expectedRevision:revision}).strict(),
]);
export type ApplicationImpactQuery=z.infer<typeof applicationImpactQuerySchema>;
/** Explanatory metadata only; never a write/stop/send authority or configuration. */
export interface ApplicationImpact {
 kind:ApplicationImpactQuery['kind'];appId:ApplicationId;checkedAt:string;
 connections:{id:string;name:string;providerId:ApplicationProvider;enabled:boolean;authorization:'connected'|'disconnected'}[];
 projects:{id:string;name:string;enabled:boolean;archived:boolean;connections:{id:string;slot:ApplicationProvider}[]}[];
 runs:{id:string;taskId:string;title:string;state:string}[];
}
