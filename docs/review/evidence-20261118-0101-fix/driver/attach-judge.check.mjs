// 判定器与回合识别的正负控（复核 W01、X01、X02）。
import { isExactlyRed, judgeAttach, turnProgress } from './attach-judge.mjs';
const Q = 'What is the dominant color?';
const good = { fixture: { sha256: 'a', isRed: true }, frozen: { sha256: 'a' }, chips: [{ cls: 'agent-chip ready' }, { cls: 'agent-chip ready' }], waitTimedOut: false, turn: { turnId: 't2', status: 'completed' }, answer: 'Red', answerShown: true, bubble: 'q README.md red.png', navigatedAway: false, rendererErrors: [], exit: { code: 0, signal: null } };
const results = {};
const expect = (name, got, want) => { results[name] = { want, got, ok: got === want }; };
// X01：回答归一
for (const a of ['Red', 'red', 'RED', ' Red. ', 'Red!']) expect(`answer:${JSON.stringify(a)}`, isExactlyRed(a), true);
for (const a of ['White', '', '  ', null, undefined, 'Not red', 'The image is white, not red.', 'Red and white', 'Reddish', 'red?', 'Red.. ', 'Dark red']) expect(`answer:${JSON.stringify(a)}`, isExactlyRed(a), false);
// 原 13 组判定（字段按本版结构）
const judged = {
  good: [good, true],
  timeout: [{ ...good, waitTimedOut: true }, false],
  noAnswer: [{ ...good, answer: undefined }, false],
  emptyAnswer: [{ ...good, answer: '  ' }, false],
  wrongAnswer: [{ ...good, answer: 'White' }, false],
  notRed: [{ ...good, answer: 'Not red' }, false],
  longNegation: [{ ...good, answer: 'The image is white, not red.' }, false],
  unfinished: [{ ...good, turn: { turnId: 't2', status: 'started' } }, false],
  turnFailed: [{ ...good, turn: { turnId: 't2', status: 'failed' } }, false],
  turnInterrupted: [{ ...good, turn: { turnId: 't2', status: 'interrupted' } }, false],
  turnUnknown: [{ ...good, turn: { turnId: 't2', status: 'unknown' } }, false],
  noTurn: [{ ...good, turn: null }, false],
  answerNotShown: [{ ...good, answerShown: false }, false],
  exitFailed: [{ ...good, exit: { code: null, signal: 'SIGKILL' } }, false],
  noExit: [{ ...good, exit: undefined }, false],
  navigated: [{ ...good, navigatedAway: true }, false],
  driverError: [{ ...good, error: 'TypeError' }, false],
  notRedFixture: [{ ...good, fixture: { sha256: 'a', isRed: false } }, false],
  frozenMismatch: [{ ...good, frozen: { sha256: 'b' } }, false],
  attempt2Shape: [{ chips: good.chips, rendererErrors: [], exit: { code: 0, signal: null }, waitTimedOut: true }, false],
};
for (const [k, [r, want]] of Object.entries(judged)) expect(`judge:${k}`, judgeAttach(r).passed, want);
// X02：回合识别——首轮已完成的回合在基线里，不参与；早到、晚到都能识别本轮终态
const first = { turn_id: 't1', status: 'completed', text: 'Say OK.' };
const base = ['t1'];
expect('turn:earlyCompleted', JSON.stringify(turnProgress(base, [first, { turn_id: 't2', status: 'completed', text: Q }], Q)), JSON.stringify({ done: true, turnId: 't2', status: 'completed' }));
expect('turn:lateStillRunning', turnProgress(base, [first, { turn_id: 't2', status: 'started', text: Q }], Q).done, false);
expect('turn:notYetAccepted', turnProgress(base, [first], Q).done, false);
expect('turn:failedAfterFirstCompleted', turnProgress(base, [first, { turn_id: 't2', status: 'failed', text: Q }], Q).status, 'failed');
expect('turn:firstCompletedDoesNotCount', turnProgress(base, [first], Q).turnId, undefined);
expect('turn:duplicate', !!turnProgress(base, [first, { turn_id: 't2', status: 'completed', text: Q }, { turn_id: 't3', status: 'completed', text: Q }], Q).error, true);
// 第二轮失败而首轮完成：判定失败
expect('judge:secondFailedFirstCompleted', judgeAttach({ ...good, turn: turnProgress(base, [first, { turn_id: 't2', status: 'failed', text: Q }], Q) }).passed, false);
console.log(JSON.stringify(results, null, 1));
const bad = Object.entries(results).filter(([, v]) => !v.ok);
if (bad.length) { console.error('正负控失败：', bad.map(([k]) => k).join(', ')); process.exit(1); }
console.log(`JUDGE_CHECK_OK ${Object.keys(results).length}`);
