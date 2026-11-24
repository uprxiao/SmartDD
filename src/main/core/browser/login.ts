import {z} from 'zod';
import {ApplicationError} from '@shared/applications';

export const loginInputSchema=z.strictObject({
  pageId:z.string().uuid(),
  origin:z.string().max(4096),
  readySelector:z.string().trim().min(1).max(512),
  checkpoint:z.string().trim().min(1).max(256),
});
export type BrowserLoginInput=z.output<typeof loginInputSchema>;
export type BrowserLoginState=BrowserLoginInput&{profileId:string;projectId:string;scriptExecutionId?:string};

export function browserLoginInput(input:unknown):BrowserLoginInput{
  const parsed=loginInputSchema.safeParse(input);
  if(!parsed.success||!['http:','https:'].includes(URL.parse(parsed.data.origin)?.protocol??'')
    ||URL.parse(parsed.data.origin)?.origin!==parsed.data.origin)
    throw new ApplicationError('INVALID_INPUT','需要原标签、站点来源和可核验的业务就绪标记');
  return parsed.data;
}
