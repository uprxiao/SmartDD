// 附件冒烟的独立判定（复核 W01）：任何一项不满足都判失败，并让驱动以非零状态退出。
// 不以“没有异常／App 正常退出”推断通过。
export function judgeAttach(r) {
  const failures = [];
  const need = (ok, why) => { if (!ok) failures.push(why); };
  need(!r.error, `驱动异常：${String(r.error ?? '').slice(0, 200)}`);
  need(r.fixture && r.fixture.sha256 && r.fixture.isRed === true, '夹具不是已核验的纯红图片');
  need(r.frozen && r.frozen.sha256 === r.fixture?.sha256, '附件副本与夹具哈希不一致');
  need(Array.isArray(r.chips) && r.chips.length === 2 && r.chips.every(c => /ready/.test(c.cls)), '附件卡片未全部就绪');
  need(r.waitTimedOut !== true, '等待回答超时');
  need(r.turnFinished === true, '回合未结束');
  need(typeof r.answer === 'string' && r.answer.trim().length > 0, '没有回答');
  need(typeof r.answer === 'string' && /\bred\b/i.test(r.answer), `回答不符合预期（期望 Red，实际 ${JSON.stringify(r.answer ?? null)}）`);
  need(typeof r.bubble === 'string' && r.bubble.includes('README.md') && r.bubble.includes('red.png'), '用户消息未带两个附件');
  need(!r.navigatedAway, '流程中页面离开了任务视图');
  need(Array.isArray(r.rendererErrors) && r.rendererErrors.length === 0, '界面有报错');
  need(r.exit && r.exit.code === 0 && r.exit.signal === null, 'App 未正常退出');
  return { passed: failures.length === 0, failures };
}
