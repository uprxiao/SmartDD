// F16 评审原型的数据与时间预览。所有任务、状态和触发均为合成数据。
export const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
export const SCHEDULE_TYPES = [
  ['interval', '固定间隔'], ['daily', '每天'], ['workdays', '工作日'],
  ['weekly', '每周指定日期'], ['once', '仅一次'],
];
export const GRACE_OPTIONS = [[0, '不补跑'], [10, '10 分钟'], [60, '1 小时'], [720, '12 小时']];
export const DESTINATIONS = [
  ['new', '每次新建任务'], ['reuse', '复用同一个任务'], ['existing', '继续指定任务'],
];
export const RUN_STATUS = {
  completed: '已完成', running: '工作中', waiting: '等待处理', failed: '失败', skipped: '已跳过', stopped: '已停止',
};
export const ACTIVE_RUNS = new Set(['running', 'waiting']);

function localParts(epoch, zone) {
  const fields = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(epoch);
  return Object.fromEntries(fields.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function asWallEpoch(p) {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second ?? 0);
}

// The P0.1 preview accepts normal wall times; ambiguous/nonexistent DST times
// remain a technical design decision for the real scheduler.
function wallInstant(parts, zone) {
  const desired = asWallEpoch(parts);
  let guess = desired;
  for (let i = 0; i < 3; i++) {
    const diff = desired - asWallEpoch(localParts(guess, zone));
    if (diff === 0) return guess;
    guess += diff;
  }
  return asWallEpoch(localParts(guess, zone)) === desired ? guess : null;
}

export function nextOccurrence(schedule, from = Date.now()) {
  if (!schedule) return null;
  if (schedule.type === 'interval') {
    const minutes = Number(schedule.minutes);
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= 10080 ? from + minutes * 60000 : null;
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(schedule.time ?? '');
  if (!match) return null;
  const hour = Number(match[1]), minute = Number(match[2]);
  try {
    if (schedule.type === 'once') {
      const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(schedule.date ?? '');
      if (!dateMatch) return null;
      const [year, month, day] = dateMatch.slice(1).map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
      const time = wallInstant({ year, month, day, hour, minute }, schedule.zone);
      return time !== null && time > from ? time : null;
    }
    const start = localParts(from, schedule.zone);
    for (let offset = 0; offset <= 7; offset++) {
      const day = new Date(Date.UTC(start.year, start.month - 1, start.day + offset));
      const weekday = day.getUTCDay();
      if (schedule.type === 'workdays' && (weekday === 0 || weekday === 6)) continue;
      if (schedule.type === 'weekly' && !schedule.days?.includes(weekday)) continue;
      const time = wallInstant({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour, minute }, schedule.zone);
      if (time !== null && time > from) return time;
    }
  } catch { return null; }
  return null;
}

export function formatRunTime(value, zone) {
  if (value === null || value === undefined) return '—';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: zone || undefined, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
}

export function scheduleLabel(schedule) {
  if (schedule.type === 'interval') return `每 ${schedule.minutes} 分钟`;
  if (schedule.type === 'once') return `${schedule.date} ${schedule.time} · 仅一次`;
  if (schedule.type === 'weekly') return `周${[...schedule.days].sort((a, b) => (a + 6) % 7 - (b + 6) % 7).map(n => WEEKDAYS[n]).join('、')} ${schedule.time}`;
  return `${schedule.type === 'workdays' ? '工作日' : '每天'} ${schedule.time}`;
}

export function defaultDraft(projects, now = Date.now()) {
  const project = projects.find(p => p.id === 'smartdd' && !p.archived) ?? projects.find(p => !p.archived);
  const dir = project?.dirs?.find(d => d.isDefault) ?? project?.dirs?.[0];
  const date = new Date(now + 86400000);
  const nextDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    name: '', prompt: '', projectId: project?.id ?? '', dirId: dir?.id ?? '', workspace: 'existing', branch: 'main',
    destination: 'new', taskId: '', agent: 'cx-sub', model: 'gpt-6.2-sol', effort: '中等',
    schedule: { type: 'workdays', time: '09:00', days: [1], minutes: 60, date: nextDate, zone: '' },
    grace: 60, enabled: true,
  };
}

export function validateDraft(draft, projects, tasks, now = Date.now()) {
  if (!draft.name.trim()) return '请输入计划名称';
  if (!draft.prompt.trim()) return '请输入任务提示词';
  const project = projects.find(p => !p.archived && p.id === draft.projectId);
  if (!project) return '请选择项目';
  const dir = project.dirs.find(d => d.id === draft.dirId && d.available !== false);
  if (!dir) return '请选择可用的工作目录';
  if (draft.workspace === 'worktree' && (dir.vcs !== 'Git' || !draft.branch.trim())) return '新建工作树需要 Git 目录和基准分支';
  if (draft.destination === 'existing' && !tasks.some(t => t.id === draft.taskId && t.project === project.id && !t.archived)) return '请选择该项目中的任务';
  if (nextOccurrence(draft.schedule, now) === null) return '请选择有效的未来执行时间';
  return '';
}

export function makeRun(plan, id, trigger, scheduledFor, status, now = Date.now()) {
  return { id, planId: plan.id, title: plan.name, trigger, scheduledFor, startedAt: status === 'skipped' ? null : now,
    finishedAt: ['completed','failed','skipped','stopped'].includes(status) ? now : null, status,
    taskId: status === 'skipped' ? null : plan.destination === 'existing' ? plan.taskId : plan.destination === 'reuse' ? `demo-task-${plan.id}` : `demo-task-${plan.id}-${id}`,
    agent: plan.agent, model: plan.model, projectId: plan.projectId, dirId: plan.dirId, prompt: plan.prompt,
    reason: status === 'skipped' ? '前次运行尚未完成' : status === 'failed' ? '智能体配置不可用' : status === 'waiting' ? '需要用户处理审批' : '',
  };
}

export function seedPlans(projects, now = Date.now()) {
  const base = defaultDraft(projects, now);
  const other = projects.find(p => p.id !== base.projectId && !p.archived);
  const otherDir = other?.dirs?.[0];
  const plans = [
    { ...base, id: 'daily-digest', name: '每日研发摘要', prompt: '整理项目最近的提交和未完成事项，生成简明研发摘要。', schedule: { ...base.schedule, type: 'workdays' } },
    { ...base, id: 'weekly-review', name: '每周代码检查', prompt: '检查项目本周改动、构建状态和需要关注的事项。', workspace: 'worktree', enabled: false, schedule: { ...base.schedule, type: 'weekly', days: [1], time: '10:00' } },
    { ...base, id: 'follow-up', name: '需求进展核对', prompt: '核对当前需求进展，整理新增问题和下一步工作。', projectId: other?.id ?? base.projectId, dirId: otherDir?.id ?? base.dirId, destination: 'reuse', agent: 'cc-sub', model: 'sonnet', effort: '中', schedule: { ...base.schedule, type: 'interval', minutes: 240 } },
  ];
  const runs = [
    makeRun(plans[0], 'seed-1', 'scheduled', now - 86400000, 'completed', now - 86300000),
    makeRun(plans[0], 'seed-2', 'scheduled', now - 172800000, 'skipped', now - 172800000),
    makeRun(plans[1], 'seed-3', 'scheduled', now - 86400000 * 3, 'failed', now - 86400000 * 3),
    makeRun(plans[2], 'seed-4', 'scheduled', now - 7200000, 'waiting', now - 7100000),
  ];
  return { plans, runs };
}
