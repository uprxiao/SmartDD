import {z} from 'zod';
export const browserCookieFamilySchema=z.enum(['chrome','edge']);
export const browserCookieSourceSchema=z.object({
  id:z.string().regex(/^[0-9a-f]{64}$/),family:browserCookieFamilySchema,
  browserLabel:z.string(),profileName:z.string(),profileDirectory:z.string(),hasCookies:z.boolean(),
}).strict();
export type BrowserCookieFamily=z.infer<typeof browserCookieFamilySchema>;
export type BrowserCookieSource=z.infer<typeof browserCookieSourceSchema>;
export interface BrowserCookieSourceList {browsers:{family:BrowserCookieFamily;label:string;installed:boolean;profiles:BrowserCookieSource[]}[]}
