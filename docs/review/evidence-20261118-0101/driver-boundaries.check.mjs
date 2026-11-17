// Review-only probes. Import the production review driver judge unchanged, and
// execute its actual wait fragment in jsdom. No Electron process or model call.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { judgeAttach } from '../evidence-20261118-0049-fix/driver/attach-judge.mjs';

const base = new URL('../evidence-20261118-0049-fix/', import.meta.url);
const saved = JSON.parse(readFileSync(new URL('attach-v2-run1/result.json', base), 'utf8'));
const driver = readFileSync(new URL('driver/m14p2-driver-attach-v2.mjs', base), 'utf8');
const start = driver.indexOf('  const before = await app.evaluate(');
const end = driver.indexOf('  result.turnFinished = ', start);
if (start < 0 || end <= start) throw new Error('Driver wait fragment changed; review extraction first');
const fragment = driver.slice(start, end);
writeFileSync(new URL('reply-wait.fragment.txt', import.meta.url), fragment);
const cases = {};
function judged(name, value, want, extra = {}) {
  const got = judgeAttach(value);
  cases[name] = { wantPassed: want, actualPassed: got.passed, matchesExpected: got.passed === want, failures: got.failures, ...extra };
}
judged('C01_saved_valid_positive', saved, true);
judged('C02_negated_red_is_not_Red', { ...saved, answer: 'Not red' }, false);
judged('C03_non_Red_answer_mentions_red', { ...saved, answer: 'The image is white, not red.' }, false);
judged('C04_old_empty_answer_timeout', { ...saved, answer: null, waitTimedOut: true }, false);

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
for (const fast of [false, true]) {
  const dom = new JSDOM('<section class="agent-task-view"><div class="agent-assistant"><div class="agent-md">OK</div></div><p>已完成</p></section>', { runScripts: 'outside-only' });
  const appendReply = () => {
    const el = dom.window.document.createElement('div'); el.className = 'agent-assistant';
    el.innerHTML = '<div class="agent-md">Red</div>';
    dom.window.document.querySelector('.agent-task-view').append(el);
  };
  if (fast) appendReply();
  const result = { ...saved }, events = [], predicates = [];
  const app = {
    evaluate: async code => dom.window.eval(code),
    waitFor: async code => {
      predicates.push(code);
      if (!fast) appendReply();
      // The completed DOM remains stable; more bounded polling cannot change it.
      for (let i = 0; i < 5; i++) if (dom.window.eval(code)) return true;
      throw new Error('review bounded timeout: predicate stays false in completed stable DOM');
    },
  };
  await new AsyncFunction('app', 'result', 'step', fragment)(app, result, (name, data) => events.push({ name, ...data }));
  const answers = [...dom.window.document.querySelectorAll('.agent-assistant .agent-md')].map(el => el.textContent);
  judged(fast ? 'C06_reply_completed_before_baseline_read' : 'C05_reply_arrives_after_baseline_read', result, true,
    { layer: 'actual driver wait fragment in jsdom; bounded polling substitute', answers, predicates, waitTimedOut: result.waitTimedOut, events, replyAlreadyCompleteWhenBaselineRead: fast });
  dom.window.close();
}
// The current turn's failure must not inherit the previous turn's completion footer.
{
  const statusStart = driver.indexOf('  result.turnFinished = ');
  const statusEnd = driver.indexOf("  step('answer'", statusStart);
  if (statusStart < 0 || statusEnd <= statusStart) throw new Error('Driver status fragment changed');
  const statusFragment = driver.slice(statusStart, statusEnd);
  writeFileSync(new URL('reply-status.fragment.txt', import.meta.url), statusFragment);
  const dom = new JSDOM('<section class="agent-task-view"><div data-turn="first"><div class="agent-assistant"><div class="agent-md">OK</div></div><div class="agent-turn-footer">已完成 · 共工作 1 秒</div></div><div data-turn="second"><div class="agent-user-bubble">q README.md red.png</div><div class="agent-assistant"><div class="agent-md">Red</div></div><div class="agent-turn-footer failed">失败 · 共工作 1 秒</div></div></section>', { runScripts: 'outside-only' });
  // jsdom lacks innerText; this static visible-text fixture has the same textContent.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, configurable: true });
  const result = { ...saved };
  await new AsyncFunction('app', 'result', statusFragment)({ evaluate: async code => dom.window.eval(code) }, result);
  judged('C07_latest_turn_failed_after_Red_previous_turn_completed', result, false,
    { layer: 'actual driver status fragment in jsdom', latestTurnStatus: 'failed', previousTurnStatus: 'completed', turnFinished: result.turnFinished, answer: result.answer });
  dom.window.close();
}
const out = { driverSha256: createHash('sha256').update(driver).digest('hex'), fragment, cases, total: Object.keys(cases).length, matched: Object.values(cases).filter(c => c.matchesExpected).length, mismatched: Object.values(cases).filter(c => !c.matchesExpected).length };
writeFileSync(new URL('driver-boundary-observations.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
process.exitCode = out.mismatched ? 1 : 0;
