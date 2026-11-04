import {z} from 'zod';
export const browserIdentitySchema=z.enum(['clean','native']);
export const browserSettingsSchema=z.object({searchEngine:z.enum(['bing','google','duckduckgo','kagi']),identity:browserIdentitySchema,pendingIdentity:browserIdentitySchema.nullable()}).strict();
export type BrowserSettingsState=z.infer<typeof browserSettingsSchema>;
