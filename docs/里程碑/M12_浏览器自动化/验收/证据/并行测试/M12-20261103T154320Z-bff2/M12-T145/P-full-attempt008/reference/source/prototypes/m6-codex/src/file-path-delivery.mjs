// Prototype-only transport lifecycle. Default transport stays local and synthetic.
// Test hosts may delay acceptance/receipts; this never calls an actual PTY or RPC.
export function createPathPreviewDelivery({ available, accept, status, transport, clock = globalThis }) {
 let serial = 0, disposed = false;
 const timers = new Set();
 const invalidate = () => { serial++; for (const timer of timers) clock.clearTimeout(timer); timers.clear(); };
 return {
  invalidate,
  dispose() { disposed = true; invalidate(); },
  async insert(taskId, data) {
   const own = ++serial, current = () => !disposed && own === serial && available();
   if (!current()) return;
   let accepted = false;
   const apply = () => { if (accepted || !current()) return false; accepted = true; accept(data); return true; };
   status('正在插入终端输入…');
   const timer = clock.setTimeout(() => { timers.delete(timer); if (current()) status('插入结果未知；尚未收到确认，不会自动重发'); }, 1500); timers.add(timer);
   try {
    const receipt = await (transport ? transport({ taskId, data, accept: apply }) : { state: apply() ? 'inserted' : 'failed', message: '任务未运行，文件路径未放入；请先恢复终端。' });
    if (!current()) return;
    if (receipt?.state === 'inserted') status('已放入完整文件路径，未发送；可继续输入或语音补充。');
    else if (receipt?.state === 'failed') status(receipt.message || '文件路径未放入；请重新拖动。');
    else status(receipt?.message || '插入结果未知；终端未确认，不会自动重发');
   } catch { if (current()) status('插入结果未知；终端未确认，不会自动重发'); }
   finally { clock.clearTimeout(timer); timers.delete(timer); }
  },
 };
}
