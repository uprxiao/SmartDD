import { useEffect, useState } from 'react';
import type { OfficeFidelityFailure } from '@shared/file-office-fidelity';
import { OfficeFidelityDetails, OFFICE_LOSSY_COPY_WARNING } from './fidelity-details';
import { Button } from '@renderer/lib/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';

interface Model {
  fidelity?: OfficeFidelityFailure; canCopyLossy: boolean; copyingLossy: boolean; copyNotice: string;
  saveLossyCopy(): Promise<void>;
}
export function OfficeFidelityNotice({ model }: { model: Model }) {
  const [confirm,setConfirm]=useState(false),failure=model.fidelity;
  useEffect(()=>setConfirm(false),[failure?.token]);
  if(!failure)return null;
  return <>
    <div className="fw-save-strip fw-office-fidelity-strip" role="alert"><OfficeFidelityDetails report={failure}/><button disabled={!model.canCopyLossy} onClick={()=>setConfirm(true)}>{model.copyingLossy?'正在另存…':'另存有损副本…'}</button></div>
    {model.copyNotice&&<div className="fw-save-strip" role="status">{model.copyNotice}</div>}
    <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>另存有损副本</DialogTitle></DialogHeader><DialogDescription className="px-6 pb-3">{OFFICE_LOSSY_COPY_WARNING}</DialogDescription><div className="px-6 pb-6"><OfficeFidelityDetails report={failure}/></div><DialogFooter><Button variant="outline" onClick={()=>setConfirm(false)}>取消</Button><Button disabled={!model.canCopyLossy} onClick={()=>{setConfirm(false);void model.saveLossyCopy();}}>另存有损副本</Button></DialogFooter></DialogContent></Dialog>
  </>;
}
