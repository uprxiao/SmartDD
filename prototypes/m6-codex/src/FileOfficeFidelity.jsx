import { useEffect, useState } from 'react';
import { OfficeFidelityDetails, OFFICE_LOSSY_COPY_WARNING } from '../../../src/renderer/features/files/office/fidelity-details';

// Prototype-only receipt callback: JSON/sample bytes never become an Office save.
export function FileOfficeFidelity({ report, onCopy }) {
  const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  useEffect(()=>{setConfirm(false);setNotice('');},[report]);
  if(!report)return null;
  return <><div className="fo-notice fo-fidelity-notice fw-office-fidelity-strip" role="alert"><OfficeFidelityDetails report={report}/><button disabled={busy} onClick={()=>setConfirm(true)}>另存有损副本…</button></div>
    {notice&&<div className="fo-notice fo-fidelity-notice" role="status">{notice}</div>}
    {confirm&&<div className="fo-dialog-backdrop" onClick={event=>{if(event.target===event.currentTarget)setConfirm(false);}} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!event.nativeEvent.isComposing){setConfirm(false);}if(event.key==='Tab'){const buttons=[...event.currentTarget.querySelectorAll('button:not(:disabled)')],first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&event.target===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&event.target===last){event.preventDefault();first?.focus();}}}}><section className="fo-dialog" role="dialog" aria-modal="true" aria-labelledby="fo-fidelity-title"><h3 id="fo-fidelity-title">另存有损副本</h3><p>{OFFICE_LOSSY_COPY_WARNING}</p><OfficeFidelityDetails report={report}/><footer><button autoFocus onClick={()=>setConfirm(false)}>取消</button><button disabled={busy} onClick={async()=>{setConfirm(false);setBusy(true);try{const result=await onCopy?.();setNotice(result?.state==='saved'?'已另存有损副本；原件未保存，草稿仍保留。':'已取消另存；原件与草稿仍保留。');}catch(error){setNotice(`有损副本未保存：${error.message}`);}finally{setBusy(false);}}}>另存有损副本</button></footer></section></div>}
  </>;
}
