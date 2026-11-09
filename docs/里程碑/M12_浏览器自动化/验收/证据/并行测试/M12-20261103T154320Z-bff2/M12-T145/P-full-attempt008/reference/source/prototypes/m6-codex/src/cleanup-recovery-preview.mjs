// P02 synthetic recovery state. No filesystem, native owner or App authority.
export function cleanupRecoveryPreview(scene, cancel = false) {
  const complete = scene === 'original' || scene === 'moved';
  const message = scene === 'partial' ? '文件已部分清理，不能直接恢复为可用；保留现场，等待恢复核查。'
    : scene === 'occupied' ? '原路径已被其他目录占用，保留双方内容，不覆盖。'
    : scene === 'unknown' ? '原清理进程尚未确认退出，保留现场。'
    : '原版本文件完整；可保留版本并取消本次清理。';
  return {scene, canCancel: complete && !cancel, state: complete && cancel ? 'ready' : 'deleting', message: complete && cancel ? '已取消本次清理，完整原版本保留；默认版本和业务数据不变。' : message};
}
