export const permissionLabels = {
  ask: { name: '请求批准', desc: '编辑外部文件和使用互联网时始终询问', icon: 'hand' },
  auto: { name: '帮我批准', desc: '仅对检测到的风险操作请求批准', icon: 'shield-prompt' },
  full: { name: '完全访问权限', desc: '可不受限制地访问互联网和你电脑上的任何文件', icon: 'alert' },
} as const;
