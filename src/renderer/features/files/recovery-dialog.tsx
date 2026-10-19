import { useEffect, useState } from 'react';
import type { FileRecoveryInspection, FileRecoveryItem } from '@shared/file-recovery';
import { rpc } from '@renderer/lib/ipc';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import { FileRecoveryView, recoveryItemKey } from '../../../../prototypes/m6-codex/src/FileRecoveryView';

export function FileRecoveryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [items, setItems] = useState<FileRecoveryItem[]>([]), [selected, setSelected] = useState<FileRecoveryItem | null>(null);
  const [inspection, setInspection] = useState<FileRecoveryInspection | null>(null), [attempt, setAttempt] = useState(0);
  const [listing, setListing] = useState(false), [reading, setReading] = useState(false), [listError, setListError] = useState(''), [readError, setReadError] = useState('');
  useEffect(() => {
    if (!open) return;
    let live = true; setListing(true); setListError('');
    void rpc.files.recovery().then(rows => {
      if (!live) return;
      const current = rows.filter(item => item.state !== 'resolved').sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      setItems(current); setSelected(previous => current.find(item => previous && recoveryItemKey(item) === recoveryItemKey(previous)) ?? current[0] ?? null);
    }).catch(() => { if (live) { setItems([]); setSelected(null); setListError('无法读取恢复记录，材料仍保留。'); } }).finally(() => { if (live) setListing(false); });
    return () => { live = false; };
  }, [open, attempt]);
  const selectedKey = selected ? recoveryItemKey(selected) : '';
  useEffect(() => {
    setInspection(null); setReadError('');
    if (!open || !selected) { setReading(false); return; }
    let live = true, pending = true; const requestId = crypto.randomUUID(); setReading(true);
    void rpc.files.inspectRecovery({ projectKey: selected.projectKey, id: selected.id, requestId }).then(result => {
      if (live) setInspection(result);
    }).catch(() => { if (live) setReadError('这条记录暂时无法核对，原件已保留。可以重新读取，或查看其他记录。'); }).finally(() => { pending = false; if (live) setReading(false); });
    return () => { live = false; if (pending) void rpc.files.cancelResource(requestId).catch(() => undefined); };
  }, [open, selectedKey, attempt]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="fw-recovery-dialog" aria-describedby={undefined}>
    <DialogHeader><DialogTitle>保存恢复材料</DialogTitle></DialogHeader>
    <FileRecoveryView items={items} selected={selectedKey} onSelect={setSelected} inspection={inspection} loading={listing || reading} error={listError || readError} onRetry={() => setAttempt(value => value + 1)}/>
  </DialogContent></Dialog>;
}
