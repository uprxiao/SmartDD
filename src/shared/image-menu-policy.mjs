// Shared approved embedded-image menu order and source/capability conditions.
export function imageMenuActions({ src = '', displaySrc = '', localPath, host = 'local', originHost = 'local', animated = false, canSelect = true, canCopy = true, clipboard = true }) {
  const address = [src, displaySrc].find(s => /^https?:\/\//i.test(s));
  return [
    { id: 'open', label: '在新标签打开图片' },
    ...(address ? [{ id: 'address', label: '复制图片地址', value: address }] : []),
    ...(!animated && canSelect ? [{ id: 'reference', label: '添加到当前任务' }] : []),
    ...(!animated && canCopy && clipboard ? [{ id: 'copy', label: '复制图片' }] : []),
    ...(localPath?.startsWith('/') && host === 'local' && originHost === host ? [{ id: 'reveal', label: '在文件管理器中显示' }] : []),
    { id: 'download', label: '下载副本' }
  ];
}

export const markdownImageMenuAllowed = (scope, hasContext) => scope !== 'other' || Boolean(hasContext);
