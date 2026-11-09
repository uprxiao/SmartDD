import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
const schema=z.record(z.string(),z.string());
/** Native --field parses JSON fragments, while --stdin intentionally preserves
 * exact text. Both represent the same declared JSON request-header object. */
export function browserHeaderValues(input:unknown):Record<string,string>{
  let value=input;
  if(typeof value==='string')try{value=JSON.parse(value);}catch{throw new ApplicationError('INVALID_INPUT','headers必须是字符串值对象的有效JSON');}
  const parsed=schema.safeParse(value);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','headers必须为字符串值对象');return parsed.data;
}
