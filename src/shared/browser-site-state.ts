import {z} from 'zod';
export function browserSiteOrigin(raw:string):string|null{try{const url=new URL(raw);return['http:','https:'].includes(url.protocol)?url.origin:null;}catch{return null;}}
export function browserCertificateHost(raw:string):string|null{
  try{const host=raw.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');const url=new URL('https://'+(host.includes(':')?'['+host+']':host));return url.hostname.replace(/^\[|\]$/g,'')===host&&url.port===''&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&!url.hash?host:null;}catch{return null;}
}
const origin=z.string().refine(value=>browserSiteOrigin(value)===value,'站点须为规范HTTP(S)来源');
const host=z.string().refine(value=>browserCertificateHost(value)===value,'主机名无效');
export const browserSiteStateSchema=z.object({schemaVersion:z.literal(1),certificates:z.array(z.object({host,createdAt:z.number().finite()}).strict()),permissions:z.array(z.object({origin,permission:z.string().min(1).max(120),decision:z.enum(['allow','deny']),updatedAt:z.number().finite()}).strict())}).strict().superRefine((value,ctx)=>{
  if(new Set(value.certificates.map(row=>row.host)).size!==value.certificates.length||new Set(value.permissions.map(row=>JSON.stringify([row.origin,row.permission]))).size!==value.permissions.length)ctx.addIssue({code:'custom',message:'站点状态重复'});
});
export type BrowserSiteState=z.infer<typeof browserSiteStateSchema>;
export interface BrowserPermissionPrompt {id:string;pageId:string;profileId:string;origin:string;permissions:string[]}
