// 附件冒烟的独立判定（复核 W01、X01、X02）：任何一项不满足都判失败，驱动以非零状态退出。
// 不以“没有异常／App 正常退出”推断通过；回答与终态都绑定本次发送的那一轮。

/** 回答归一规则（X01）：去掉首尾空白与至多一个句末标点（. 或 !）后，整串忽略大小写等于 red。 */
export function isExactlyRed(answer) {
  if (typeof answer !== 'string') return false;
  return /^red[.!]?$/i.test(answer.trim());
}

export const TERMINAL = new Set(['completed', 'failed', 'interrupted', 'unknown', 'canceled']);
/**
 * 本次回合的识别与进度（X02）：baselineIds 是发送前已有的回合；本次回合 = 不在基线里、输入原文等于本次问题的那一条。
 * 只看这一轮的终态，历史回合的完成状态不参与。发送后立即完成（早到）与之后才完成（晚到）一视同仁。
 */
export function turnProgress(baselineIds, rows, question) {
  const mine = rows.filter(r => !baselineIds.includes(r.turn_id) && r.text === question);
  if (mine.length > 1) return { done: true, error: `本次问题对应 ${mine.length} 个新回合` };
  if (!mine.length) return { done: false };
  const t = mine[0];
  return { done: TERMINAL.has(t.status), turnId: t.turn_id, status: t.status };
}

export function judgeAttach(r) {
  const failures = [];
  const need = (ok, why) => { if (!ok) failures.push(why); };
  need(!r.error, `驱动异常：${String(r.error ?? '').slice(0, 200)}`);
  need(r.fixture && r.fixture.sha256 && r.fixture.isRed === true, '夹具不是已核验的纯红图片');
  need(r.frozen && r.frozen.sha256 === r.fixture?.sha256, '附件副本与夹具哈希不一致');
  need(Array.isArray(r.chips) && r.chips.length === 2 && r.chips.every(c => /ready/.test(c.cls)), '附件卡片未全部就绪');
  need(r.waitTimedOut !== true, '等待本轮结束超时');
  need(!!r.turn?.turnId, '未识别到本次发送的回合');
  need(r.turn?.status === 'completed', `本轮未完成（状态 ${JSON.stringify(r.turn?.status ?? null)}）`);
  need(isExactlyRed(r.answer), `回答不是 Red（实际 ${JSON.stringify(r.answer ?? null)}）`);
  need(r.answerShown === true, '界面没有显示本轮回答');
  need(typeof r.bubble === 'string' && r.bubble.includes('README.md') && r.bubble.includes('red.png'), '用户消息未带两个附件');
  need(!r.navigatedAway, '流程中页面离开了任务视图');
  need(Array.isArray(r.rendererErrors) && r.rendererErrors.length === 0, '界面有报错');
  need(r.exit && r.exit.code === 0 && r.exit.signal === null, 'App 未正常退出');
  return { passed: failures.length === 0, failures };
}
