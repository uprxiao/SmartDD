// Prototype-only image handoff. Payloads refer to the synthetic catalog or
// embedded PNG bytes; this never launches a CLI, uploads, or submits a message.
export function createImagePreviewDelivery({ available, accept, transport, clock = globalThis }) {
  let active = null, disposed = false;
  const jobs = new Map();
  const stop = job => {
    clock.clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.abort);
  };
  const cancel = () => {
    const job = active; active = null;
    if (!job) return;
    job.live = false; stop(job);
    job.resolve({ state: 'failed', message: '图片准备已取消；已有输入和图片保留。' });
  };
  return {
    invalidate: cancel,
    dispose() { disposed = true; cancel(); jobs.clear(); },
    insert(request) {
      if (jobs.has(request.requestId)) return jobs.get(request.requestId);
      const fail = message => { const receipt = { state: 'failed', message }; request.onState?.(receipt); return Promise.resolve(receipt); };
      if (disposed || !available() || request.signal?.aborted) return fail('当前任务没有可用终端，图片未加入。');
      if (active) return fail('上一张图片仍在准备或结果未知，请先检查当前终端；不会自动重发。');
      if (request.capability === 'unsupported') return fail('当前适配器明确不支持图片输入，图片未加入。');
      if (request.capability !== 'supported') return fail('当前适配器图片输入能力未知，图片未加入。');
      const image = request.image;
      if (image?.kind !== 'synthetic-image' || !image.sourceId || image.mime !== 'image/png' ||
          !/^(?:data:image\/png;base64,[A-Za-z0-9+/]+=*|\/assets\/[A-Za-z0-9_./-]+\.png)$/.test(image.src || '')) {
        return fail('此图片没有可确认的 PNG 载荷，图片未加入。');
      }
      const job = { ...request, image: Object.freeze({ ...image }), live: true, accepted: false, unknown: false };
      job.promise = new Promise(resolve => { job.resolve = resolve; });
      jobs.set(job.requestId, job.promise); active = job;
      const current = () => !disposed && active === job && job.live && !job.signal?.aborted && available();
      const finish = receipt => {
        if (!current() || job.unknown) return;
        const state = receipt?.state === 'inserted' && job.accepted ? 'inserted' : receipt?.state === 'failed' && !job.accepted ? 'failed' : 'unknown';
        clock.clearTimeout(job.timer);
        if (state !== 'unknown') job.signal?.removeEventListener('abort', job.abort);
        const result = { state, message: receipt?.message || (state === 'inserted' ? '图片已加入当前示例终端草稿，未发送。' : state === 'failed' ? '图片准备失败，已有输入和图片保留。' : '图片投递结果未知，请检查当前终端；不会自动重发。') };
        job.unknown = state === 'unknown';
        job.onState?.(result); job.resolve(result);
        if (!job.unknown) { job.live = false; active = null; }
      };
      job.abort = () => { if (active === job) cancel(); };
      job.signal?.addEventListener('abort', job.abort, { once: true });
      const apply = () => {
        if (!current() || job.unknown || job.accepted) return false;
        job.accepted = true; accept(job.image); return true;
      };
      job.onState?.({ state: 'pending', message: '正在准备图片输入…' });
      job.timer = clock.setTimeout(() => finish({ state: 'unknown' }), 1500);
      // accept() is the only synthetic attachment write and rechecks the captured
      // task/source lifetime after a delayed preparation or receipt.
      Promise.resolve().then(() => transport ? transport({ ...request, image: job.image, accept: apply }) : { state: apply() ? 'inserted' : 'failed' })
        .then(finish, () => finish({ state: 'unknown' }));
      return job.promise;
    },
  };
}
