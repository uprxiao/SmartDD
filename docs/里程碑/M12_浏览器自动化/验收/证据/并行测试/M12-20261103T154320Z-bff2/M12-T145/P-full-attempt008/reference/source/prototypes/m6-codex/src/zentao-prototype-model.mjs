export const BUGS = [
  { id: 812, title: '导出项目时，目录不可用提示没有指向具体位置', priority: 'P1', state: '激活', module: '项目迁移', detail: '当项目包含两个代码目录，其中一个目录不可用时，导出提示需要指出对应目录。\n\n重现步骤\n1. 打开包含多个目录的示例项目。\n2. 将其中一个目录标为不可用。\n3. 查看导出前检查。\n\n预期：提示具体目录，并提供返回配置入口。', history: '今天 09:40 · 测试同事提交\n今天 10:05 · 指派给 demo.user' },
  { id: 807, title: '长名称在连接详情页中遮挡操作菜单', priority: 'P2', state: '激活', module: '连接管理', detail: '连接名称较长时需要换行或截断，操作入口仍应可用。', history: '昨天 16:20 · 指派给 demo.user' },
  { id: 798, title: '断网恢复后，列表仍保留上次失败状态', priority: 'P2', state: '已解决', module: '数据读取', detail: '恢复网络后重新检查连接，保留数据的抓取时间。', history: '昨天 14:00 · 标记为已解决' },
];
export const STORIES = [
  { id: 146, title: '在项目中选用已连接的外部应用', priority: 'P1', state: '激活', module: '应用接入', detail: '作为开发者，我希望在项目里选择已经配置的连接，便于 Agent 获取当前任务需要的数据。\n\n验收标准\n• 能看到连接账号、可用状态和读取能力。\n• 停用的连接不可用于新调用。\n• 切换项目后不能沿用其他项目的授权。', history: '今天 11:00 · 需求评审通过\n今天 11:30 · 指派给 demo.user' },
  { id: 141, title: '查看仅保存在本地的历史邮件', priority: 'P2', state: '激活', module: '邮件', detail: '从本机 Foxmail 来源查询历史邮件，显示内容时间及附件缺失状态。', history: '昨天 15:00 · 指派给 demo.user' },
];
// Synthetic-only P05 data. Type remains part of identity when numeric IDs collide.
export function demoZentaoPage(kind, query = '', page = 1, scene = 'ready') {
  if (!['bug', 'story'].includes(kind)) throw new Error('Unknown demo object type');
  const long = scene === 'long', needle = String(query).trim().toLowerCase();
  const rows = (kind === 'bug' ? BUGS : STORIES).map((item, index) => ({
    ...item, type: kind, id: long && kind === 'story' && index === 0 ? BUGS[0].id : item.id,
    title: long ? item.title + '——跨团队多目录和复杂环境下的完整边界说明与后续验收补充' : item.title,
    detail: long ? item.detail + ('\n补充边界：仅当前对象及其来源，未确认内容应单独说明。').repeat(18) : item.detail,
    history: long ? item.history + ('\n历史说明：保留实际对象类型、账号与来源，不合并同号对象。').repeat(10) : item.history,
    attachmentMissing: long || scene === 'partial',
  })).filter(item => !needle || [item.id,item.title,item.module,item.detail].join(' ').toLowerCase().includes(needle));
  const pageSize = 2, pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(pages, Math.max(1, Number.isSafeInteger(page) ? page : 1));
  return {items:rows.slice((current-1)*pageSize,current*pageSize), total:rows.length, page:current, pages};
}
