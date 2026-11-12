import {z} from 'zod';

/** Only host-issued read identities cross this boundary. No caller-supplied URL, text or reference payload. */
export const pluginUiActionRequestSchema=z.object({
  receiptId:z.uuid(),actionIndex:z.number().int().min(0).max(31),
  row:z.object({receiptId:z.uuid(),index:z.number().int().min(0).max(10000),tabId:z.string().min(1).max(64).optional()}).strict(),
  detailId:z.string().min(1).max(64).optional(),
}).strict();
export type PluginUiActionRequest=z.infer<typeof pluginUiActionRequestSchema>;
export type PreparedPluginUiAction={
  id:string;appId:string;projectId:string;title:string;closeOnDone:boolean;expiresAt:number;
}&({kind:'insertTerminal';text:string}|{kind:'openUrl';url:string});
