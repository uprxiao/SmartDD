import { extname } from 'node:path';
import type { ValidatedPlugin } from './package';

const LIMIT=128*1024;
/** Read only declared, already-verified package bytes. Return passive image
 * data, never a file URL, network URL, HTML fragment or plugin JavaScript. */
export function pluginCatalogIcons(plugin:Pick<ValidatedPlugin,'files'>&{manifest:Pick<ValidatedPlugin['manifest'],'icon'>}):{light:string|null;dark:string|null}|null{
  if(!plugin.manifest.icon)return null;
  const image=(path:string):string|null=>{
    const bytes=plugin.files.get(path);if(!bytes||!bytes.length||bytes.length>LIMIT)return null;
    let mime:string|null=null;
    if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime='image/png';
    else if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)mime='image/jpeg';
    else if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')mime='image/webp';
    else if(extname(path).toLowerCase()==='.svg'&&/^\s*(?:<\?xml[^>]*>\s*)?<svg(?:\s|>)/i.test(bytes.toString('utf8')))mime='image/svg+xml';
    return mime?`data:${mime};base64,${bytes.toString('base64')}`:null;
  };
  return {light:image(plugin.manifest.icon.light),dark:image(plugin.manifest.icon.dark)};
}
