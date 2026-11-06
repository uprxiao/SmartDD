import {cacheUsagePreview,CACHE_USAGE_SCENES,CACHE_USAGE_ERROR} from './mail-cache-preview.mjs';
import {useEffect,useRef,useState} from 'react';

// Synthetic preview only. Keep cleanup confirmation aligned with MailCachePanel;
// no product cache API or persisted business state is changed here.
export function PrototypeMailCache({Dialog,onNotice}) {
  const [scene,setScene]=useState('ready'),[confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [usageScene,setUsageScene]=useState('ready');
  const usage=cacheUsagePreview(usageScene);
  const bytes=n=>new Intl.NumberFormat('zh-CN',{maximumFractionDigits:2}).format(n/1000000)+' MB';
  const timer=useRef(null),pending=useRef(false);
  useEffect(()=>()=>{clearTimeout(timer.current);},[]);
  const close=()=>{if(!pending.current)setConfirm(false);};
  const clear=()=>{
    if(pending.current)return;
    pending.current=true;setBusy(true);setError('');
    timer.current=setTimeout(()=>{
      timer.current=null;pending.current=false;setBusy(false);
      if(scene==='busy'||scene==='failed'){
        setError(scene==='busy'?'示例缓存正在使用，暂不删除；不会强停Agent。':'模拟清理失败：保留业务数据，暂停新增缓存；不偷偷缩小查询范围。');
        return;
      }
      setConfirm(false);
      onNotice(scene==='recovered'?'已模拟重建索引；故障原件保留并计入500 MB预算，没有删除源邮箱或业务数据。':'已模拟清理可重建缓存；再次读取可重建。Foxmail原邮件、草稿、发送记录和附件副本保留。');
    },350);
  };
  return <><details className="m10-mail-cache">
    <summary>本地占用与缓存</summary>
    {usageScene==='loading'?<p>正在读取缓存占用…</p>:usageScene==='failed'?<p role="alert">{CACHE_USAGE_ERROR}</p>:<>
      <p>可重建缓存：{bytes(usage.actual.total)} / {bytes(usage.limit)}；索引 {bytes(usage.actual.index)}，对象 {bytes(usage.actual.objects)}，辅助文件 {bytes(usage.actual.auxiliary)}，临时写入 {bytes(usage.actual.staging)}。</p>
      {usage.recoveryRetainedBytes>0&&<p className="m10-muted">为恢复核对保留的故障原件：{new Intl.NumberFormat('zh-CN').format(usage.recoveryRetainedBytes)} 字节，已计入缓存预算；不会自动删除这些原件。</p>}
      <p>{usage.activeLeases} 项当前占用{usage.overBudget?' · 超出预算，新增缓存受限':''}{usage.unrecognized.length?' · 存在未识别文件，保守保留':''}</p>
      <p>邮件业务文件：{usage.storage.business.files.complete?bytes(usage.storage.business.files.bytes):'统计未完成'}（正文、保留附件与临时保存文件）；{usage.storage.business.drafts} 个草稿 · {usage.storage.business.sends} 条发送记录。</p>
      <p>共享业务数据库：{usage.storage.business.sharedDatabase.complete?bytes(usage.storage.business.sharedDatabase.bytes):'统计未完成'}。共享数据库包含其他业务，不单独归属于邮件；以上为当前文件字节快照，不与缓存合计为总空间。</p>
      <p>邮件应用版本占用：</p>
      {usage.storage.versions?usage.storage.versions.items.map(item=><p key={item.packageHash}>v{item.version} · 原件 {item.sourceBytes===null?'统计未完成':bytes(item.sourceBytes)} · 派生 {item.projectionBytes===null?'统计未完成':bytes(item.projectionBytes)}{item.retentionReasons.length?' · '+item.retentionReasons.join('、'):''}</p>):<p>应用版本占用统计未完成</p>}
      <p className="m10-muted">版本含共享依赖，逐版本查看，不重复累加；业务数据和历史版本可能持续增长，500 MB仅限制可重建缓存。</p>
    </>}
    <p>30天未使用自动回收；使用中的资源先保留。Foxmail 原邮件、草稿、发送记录与其附件副本独立保留。</p>
    <button className="m10-button secondary" onClick={()=>{setError('');onNotice('');setConfirm(true);}}>清理可重建缓存</button>
    {confirm&&<Dialog title="清理邮件缓存" closingDisabled={busy} onClose={close}>
      <p className="m10-modal-copy">只清理当前允许删除的可重建缓存。使用中的资源保留；不会停止 Agent，不删除原邮箱、草稿、发送记录或其附件。</p>
      {error&&<p className="m10-note" role="alert">{error}</p>}
      <footer><button className="m10-button secondary" disabled={busy} onClick={close}>取消</button><button className="m10-button primary" disabled={busy} onClick={clear}>{busy?'清理中…':'清理缓存'}</button></footer>
    </Dialog>}
  </details>
  <details className="m10-connection-preview" open><summary>缓存占用与清理演示 · 仅合成</summary><p>固定合成统计，不读取实际文件，不改变项目、草稿、发送记录或来源。</p><label>占用统计场景<select aria-label="缓存占用统计场景" value={usageScene} onChange={e=>setUsageScene(e.target.value)}>{CACHE_USAGE_SCENES.map(([value,title])=><option key={value} value={value}>{title}</option>)}</select></label><label>清理场景<select aria-label="缓存清理场景" value={scene} onChange={e=>setScene(e.target.value)}><option value="ready">允许清理</option><option value="busy">资源占用中</option><option value="failed">清理失败／磁盘不足</option><option value="recovered">故障原件保留</option></select></label></details>
  </>;
}
