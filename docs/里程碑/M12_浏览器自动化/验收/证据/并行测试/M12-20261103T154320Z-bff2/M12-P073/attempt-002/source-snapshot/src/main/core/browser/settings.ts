import type Database from 'better-sqlite3';
import {ApplicationError} from '@shared/applications';
import {browserSettingsSchema,type BrowserSettingsState} from '@shared/browser-settings';
const KEY='browserSettings.v1';
export function browserUserAgent(native:string,mode:BrowserSettingsState['identity']):string{
  return mode==='native'?native:native.replace(/\s+(?:Electron|SmartDD|WillYou)\/[^\s]+/g,'');
}
export class BrowserSettings {
  private state:BrowserSettingsState;
  constructor(private readonly db:Database.Database){
    const row=db.prepare('SELECT value FROM app_settings WHERE key=?').get(KEY) as {value:string}|undefined;
    try{if(row&&Buffer.byteLength(row.value)>4*1024*1024)throw Error();this.state=row?browserSettingsSchema.parse(JSON.parse(row.value)):{searchEngine:'bing',identity:'clean',pendingIdentity:null};}
    catch{throw new ApplicationError('BROWSER_UNAVAILABLE','浏览器设置损坏；原数据已保留');}
    if(this.state.pendingIdentity!==null)this.save({...this.state,identity:this.state.pendingIdentity,pendingIdentity:null});
  }
  snapshot():BrowserSettingsState{return{...this.state};}
  private save(next:BrowserSettingsState,dispatched:()=>void=()=>{}):void{
    const parsed=browserSettingsSchema.parse(next),value=JSON.stringify(parsed);dispatched();
    this.db.prepare('INSERT INTO app_settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(KEY,value,Date.now());this.state=parsed;
  }
  setIdentity(mode:BrowserSettingsState['identity'],reset=false,dispatched:()=>void=()=>{}){
    const target=reset?'clean':mode;this.save({...this.state,pendingIdentity:target===this.state.identity?null:target},dispatched);
    return{mode:this.state.identity,pendingMode:this.state.pendingIdentity,restartRequired:this.state.pendingIdentity!==null};
  }
  setSearchEngine(searchEngine:BrowserSettingsState['searchEngine']):void{this.save({...this.state,searchEngine});}
}
