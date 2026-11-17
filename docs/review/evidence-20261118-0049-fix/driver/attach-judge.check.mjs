// 判定器正负控（复核 W01）：超时、空回答、答非预期、回合未结束、退出失败、跳页都必须判失败。
import { judgeAttach } from './attach-judge.mjs';
const good = { fixture: { sha256: 'a', isRed: true }, frozen: { sha256: 'a' }, chips: [{ cls: 'agent-chip ready' }, { cls: 'agent-chip ready' }], waitTimedOut: false, turnFinished: true, answer: 'Red', bubble: 'q README.md red.png', navigatedAway: false, rendererErrors: [], exit: { code: 0, signal: null } };
const cases = {
  good: [good, true],
  timeout: [{ ...good, waitTimedOut: true }, false],
  noAnswer: [{ ...good, answer: undefined }, false],
  emptyAnswer: [{ ...good, answer: '  ' }, false],
  wrongAnswer: [{ ...good, answer: 'White' }, false],
  unfinished: [{ ...good, turnFinished: false }, false],
  exitFailed: [{ ...good, exit: { code: null, signal: 'SIGKILL' } }, false],
  noExit: [{ ...good, exit: undefined }, false],
  navigated: [{ ...good, navigatedAway: true }, false],
  driverError: [{ ...good, error: 'TypeError' }, false],
  notRedFixture: [{ ...good, fixture: { sha256: 'a', isRed: false } }, false],
  frozenMismatch: [{ ...good, frozen: { sha256: 'b' } }, false],
  // 第 2 次的实际形状：卡片就绪、等待超时、没有回答、正常退出
  attempt2Shape: [{ chips: good.chips, rendererErrors: [], exit: { code: 0, signal: null }, waitTimedOut: true }, false],
};
const out = Object.fromEntries(Object.entries(cases).map(([k, [r, want]]) => { const j = judgeAttach(r); return [k, { want, got: j.passed, ok: j.passed === want, failures: j.failures }]; }));
console.log(JSON.stringify(out, null, 1));
if (!Object.values(out).every(c => c.ok)) { console.error('判定器正负控失败'); process.exit(1); }
console.log('JUDGE_CHECK_OK');
