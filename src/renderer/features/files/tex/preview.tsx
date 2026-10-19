import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { TEX_LIMITS, type TexPreviewResult } from '@shared/file-tex';
import { rpc } from '@renderer/lib/ipc';
import type { FileBuffer } from '../file-buffer';
import { bytesFromBase64, fileErrorMessage } from '../file-buffer';
import { FilePdfPreview } from '../pdf/preview';
import './style.css';

export function FileTexPreview({ buffer }: { buffer: FileBuffer }) {
  const [result, setResult] = useState<TexPreviewResult | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [cancelled, setCancelled] = useState(false);
  const active = useRef<{ id: string; stop: () => void } | null>(null);
  useEffect(() => {
    const id = crypto.randomUUID(); let disposed = false;
    const stop = () => { disposed = true; void rpc.files.releaseTex(id).catch(() => undefined); };
    active.current = { id, stop }; setResult(null); setError(''); setCancelled(false);
    void rpc.files.compileTex({ id, ref: buffer.file.ref, baseHash: buffer.file.revision.hash }).then((value) => { if (!disposed) setResult(value); }, (failure) => { if (!disposed) setError(fileErrorMessage(failure)); });
    return () => { stop(); if (active.current?.id === id) active.current = null; };
  }, [buffer, buffer.file.revision.hash, attempt]);
  const load = useCallback(async (signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> => {
    if (!result || result.bytes > TEX_LIMITS.outputBytes) throw new Error('TeX PDF 尚未生成或超过 40 MiB');
    const bytes = new Uint8Array(result.bytes);
    for (let offset = 0; offset < bytes.length; offset += TEX_LIMITS.chunkBytes) {
      signal.throwIfAborted(); const length = Math.min(TEX_LIMITS.chunkBytes, bytes.length - offset), chunk = bytesFromBase64(await rpc.files.texChunk(result.id, offset, length));
      if (chunk.length !== length) throw new Error('TeX PDF 分块长度不匹配'); bytes.set(chunk, offset);
    }
    signal.throwIfAborted(); const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== result.hash) throw new Error('TeX PDF 内容校验失败'); return bytes;
  }, [result]);
  return <section className="fw-tex" aria-label="TeX 编译预览">
    {result ? <><FilePdfPreview buffer={buffer} loadData={load} />{(result.warnings.length > 0 || result.diagnostic) && <details className="fw-tex-diagnostics"><summary>编译信息</summary>{result.warnings.map((message) => <p key={message}>{message}</p>)}<pre>{result.diagnostic}</pre></details>}</> : <div className="fw-empty" role={error ? 'alert' : 'status'}>
      {!error && !cancelled && <Loader2 size={20} className="animate-spin" />}<p>{error ? 'TeX 编译失败，源码已保留' : cancelled ? '已取消编译' : '正在生成 PDF…'}</p>
      {error && <pre className="fw-tex-error">{error}</pre>}
      {error || cancelled ? <button onClick={() => setAttempt((value) => value + 1)}>重新编译</button> : <button onClick={() => { active.current?.stop(); setCancelled(true); }}>取消编译</button>}
    </div>}
  </section>;
}
