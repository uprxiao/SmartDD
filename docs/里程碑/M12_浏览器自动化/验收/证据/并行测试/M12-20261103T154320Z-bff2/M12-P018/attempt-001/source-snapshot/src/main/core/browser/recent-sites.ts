import {isBrowserSearchUrl} from '@shared/browser-navigation';
import type {BrowserWorkspaceState} from '@shared/browser-workspace';
type Recent=BrowserWorkspaceState['recent'];
export function browserRecentVisit(recent:Recent,url:string,title:string,visitedAt:number):Recent{
  if(isBrowserSearchUrl(url))return recent;
  let host:string;try{const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))return recent;host=parsed.host;}catch{return recent;}
  return[{url,title,host,visitedAt},...recent.filter(site=>site.host!==host)].slice(0,8);
}
/** The final document title often arrives after did-navigate. Updating a title
 * must not count as a new visit or reorder another task's recent site. */
export function browserRecentTitle(recent:Recent,url:string,title:string):Recent{
  if(!recent.some(site=>site.url===url&&site.title!==title))return recent;
  return recent.map(site=>site.url===url?{...site,title}:site);
}
