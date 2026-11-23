export const permissionLabels = {
  ask: { name: '请求批准', desc: '编辑外部文件和使用互联网时询问', otherDesc: '执行器请求工具权限时询问', icon: 'hand' },
  auto: { name: '帮我批准', desc: '由 Codex 审查需要批准的操作', otherDesc: '', icon: 'shield-prompt' },
  full: { name: '完全访问权限', desc: '允许访问电脑文件和互联网', otherDesc: '允许执行器自动批准工具操作', icon: 'alert' },
} as const;
