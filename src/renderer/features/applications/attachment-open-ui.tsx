import type {FileApplications} from '@shared/files';
import {AppDialog} from './controls';

export function AttachmentOpenDialog({filename,applications,selected,onSelect,busy,error,onOpen,onClose}:{filename:string;applications:FileApplications|null;selected:string;onSelect:(id:string)=>void;busy:boolean;error:string;onOpen:()=>void;onClose:()=>void}){
 return <AppDialog title="打开已保存附件" closingDisabled={busy} onClose={onClose}>
  <p>{filename}</p><p className="m10-muted">打开你选择保存的副本。外部改动不回写原附件；系统接受请求不代表已阅读或分析内容。</p>
  {!applications?(!error&&<p role="status">正在核对副本和可用应用…</p>):applications.apps.length?<label className="m10-field">打开方式<select className="m10-select" aria-label="附件打开方式" disabled={busy} value={selected} onChange={e=>onSelect(e.target.value)}><option value="">请选择应用</option>{applications.apps.map(app=><option key={app.id} value={app.id}>{app.name}{app.systemDefault?'（系统默认）':''}</option>)}</select></label>:<p role="status">本机没有发现可打开此副本的应用。文件已保存，可在系统中处理。</p>}
  {error&&<p className="m10-note" role="alert">{error}</p>}
  <footer><button className="m10-button secondary" disabled={busy} onClick={onClose}>取消</button><button className="m10-button primary" disabled={busy||!selected||!applications?.apps.some(app=>app.id===selected)} onClick={onOpen}>{busy?'正在处理…':'打开'}</button></footer>
 </AppDialog>;
}
