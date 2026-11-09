import {describe,it,expect} from 'vitest';
import Database from 'better-sqlite3';
import {BrowserSettings,browserUserAgent} from '../settings';
import {SEARCH_ENGINES,type BrowserSearchEngine} from '@shared/browser-navigation';
describe('browser identity and durable settings',()=>{
  it('applies identity only on next startup and reset schedules the default',()=>{
    const db=new Database(':memory:');db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');
    try{const first=new BrowserSettings(db);expect(first.snapshot()).toEqual({searchEngine:'bing',identity:'clean',pendingIdentity:null});expect(first.setIdentity('native')).toEqual({mode:'clean',pendingMode:'native',restartRequired:true});expect(first.snapshot().identity).toBe('clean');const second=new BrowserSettings(db);expect(second.snapshot().identity).toBe('native');expect(second.snapshot().pendingIdentity).toBeNull();expect(second.setIdentity('native',true)).toEqual({mode:'native',pendingMode:'clean',restartRequired:true});expect(new BrowserSettings(db).snapshot().identity).toBe('clean');first.setSearchEngine('duckduckgo');expect(new BrowserSettings(db).snapshot().searchEngine).toBe('duckduckgo');}finally{db.close();}
  });
  it('preserves a corrupt setting without silently reverting user choices',()=>{
    const db=new Database(':memory:');db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');try{const value='{"identity":"foreign"}';db.prepare('INSERT INTO app_settings VALUES(?,?,1)').run('browserSettings.v1',value);expect(()=>new BrowserSettings(db)).toThrow('原数据已保留');expect(db.prepare('SELECT value FROM app_settings WHERE key=?').get('browserSettings.v1')).toEqual({value});}finally{db.close();}
  });
  it('removes only the application/Electron tokens in clean mode, preserving the native string otherwise',()=>{
    const native='Mozilla/5.0 (Macintosh) AppleWebKit/537.36 SmartDD/0.1.1 Chrome/146.0.1 Electron/42.11.14 Safari/537.36';expect(browserUserAgent(native,'native')).toBe(native);expect(browserUserAgent(native,'clean')).toBe('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/146.0.1 Safari/537.36');
  });
  it('accepts and durably restores every search engine offered by the address bar',()=>{
    const db=new Database(':memory:');db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');try{for(const searchEngine of Object.keys(SEARCH_ENGINES) as BrowserSearchEngine[]){new BrowserSettings(db).setSearchEngine(searchEngine);expect(new BrowserSettings(db).snapshot().searchEngine).toBe(searchEngine);}}finally{db.close();}
  });
});
