import type { FileRecoveryInspection, FileRecoveryItem, FileRecoveryMaterialKind } from '../../../src/shared/file-recovery';
import './file-recovery.css';

const states: Record<string, string> = { dirty: '未保存草稿', preparing: '保存中断', prepared: '保存中断', unknown: '保存结果待核对', conflict: '保存冲突', 'needs-inspection': '需要核对', 'saved-history': '已保存的历史材料', saved: '已保存的历史材料', failed: '保存未完成', invalid: '材料需要检查' };
const labels: Record<FileRecoveryMaterialKind, string> = { current: '当前磁盘版本', displaced: '交换前的磁盘版本', draft: '独立保存的本地草稿', materialized: '本次保存的候选版本' };
export const recoveryItemKey = (item: FileRecoveryItem) => `${item.projectKey}/${item.id}`;

/** Shared presentation only. The prototype supplies synthetic data; the App
 * supplies native, verified snapshots. This component cannot read or write. */
export function FileRecoveryView({ items, selected, onSelect, inspection, loading, error, onRetry }: {
  items: FileRecoveryItem[]; selected: string; onSelect: (item: FileRecoveryItem) => void;
  inspection: FileRecoveryInspection | null; loading: boolean; error: string; onRetry: () => void;
}) {
  return <div className="fw-recovery-view">
    <p className="fw-recovery-description">核对各版本后再处理保存问题。查看不会覆盖文件，也不会清理恢复材料；关闭此窗口后材料仍保留。</p>
    <div className="fw-recovery-layout">
      <nav className="fw-recovery-records" aria-label="保存恢复记录">
        {items.map(item => <button type="button" key={recoveryItemKey(item)} data-record={item.id} aria-pressed={selected === recoveryItemKey(item)} onClick={() => onSelect(item)} title={item.relativePath || item.id}>
          <span>{item.relativePath || '保存恢复记录'}</span><small>{states[item.state] || '需要核对'}{item.sourceAvailable === false ? ' · 原目录不可用' : ''}</small>
          <small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : item.id}</small>
        </button>)}
        {!loading && !items.length && !error && <p role="status">暂无需要查看的恢复材料。</p>}
      </nav>
      <section className="fw-recovery-materials" aria-label="恢复版本" aria-busy={loading}>
        {loading && <p role="status">正在核对恢复材料…</p>}
        {error && <div role="alert"><p>{error}</p><button className="fw-pill" type="button" onClick={onRetry}>重新读取</button></div>}
        {!loading && !error && inspection && <>
          <p className="fw-recovery-state" role="status">{states[inspection.state] || '需要核对'} · 只读</p>
          {inspection.materials.map(material => <details key={material.kind} data-material={material.kind} open={material.kind !== 'materialized'}>
            <summary>{labels[material.kind]}<small>{material.available ? `${material.revision!.size.toLocaleString()} 字节` : '暂不可读'}</small></summary>
            {material.available ? <>
              {material.changed && <p role="status">此版本已与保存记录中的版本不同，请保留并核对。</p>}
              {material.preview === null ? <p>此版本不提供文本预览，完整材料仍保留。</p> : <pre tabIndex={0} aria-label={labels[material.kind]}>{material.preview}</pre>}
              {material.truncated && <p>预览最多读取前 256 KiB；完整版本仍保留。</p>}
              <dl><dt>SHA-256</dt><dd>{material.revision!.hash}</dd></dl>
            </> : <p>{material.message || '此版本当前不可读，其余材料仍保留。'}</p>}
          </details>)}
        </>}
      </section>
    </div>
  </div>;
}
