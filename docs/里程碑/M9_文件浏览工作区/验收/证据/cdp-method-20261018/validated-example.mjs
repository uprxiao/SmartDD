import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openElectron } from '/Users/hx/hx/hxWork/SmartDD/scripts/lib/electron-harness.mjs';

const executable = process.env.WILLYOU_ACCEPTANCE_APP;
assert(executable, 'Set WILLYOU_ACCEPTANCE_APP to the packaged executable');
const scratch = await mkdtemp(join(tmpdir(), 'willyou-cdp-example-'));
const userData = join(scratch, 'userdata');
const result = { startedAt: new Date().toISOString(), executable, scratch,
  layer: 'A: packaged UI smoke only', checks: [], status: 'running' };
let app;
try {
  app = await openElectron({ executable, userData });
  const selector = '[data-testid="nav-settings"]';
  await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const point = await app.evaluate(`(async () => {
    const e = document.querySelector(${JSON.stringify(selector)});
    e.scrollIntoView({ block: 'nearest' });
    await new Promise(requestAnimationFrame);
    const r = e.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (!r.width || !r.height || e.matches(':disabled') ||
        !e.contains(document.elementFromPoint(x, y))) throw new Error('Target is not interactable');
    return { x, y };
  })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await app.cdp('Input.dispatchMouseEvent', { type, ...point,
      ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) });
  }
  await app.waitFor(`document.querySelector('.settings-shell')?.getBoundingClientRect().width > 0 &&
    document.querySelector('.settings-shell .setting-path')?.textContent === ${JSON.stringify(userData)}`);
  result.checks.push({ name: 'Actual settings click shows this isolated userData', passed: true });
  assert.deepEqual(app.rendererErrors, []);
  await app.screenshot(join(scratch, 'settings.png'));
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = String(error);
  process.exitCode = 1;
  if (app) await app.screenshot(join(scratch, 'failure.png')).catch(() => {});
} finally {
  if (app) {
    await writeFile(join(scratch, 'electron.log'), app.logs());
    await app.close();
  }
  result.finishedAt = new Date().toISOString();
  await writeFile(join(scratch, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ status: result.status, scratch }));
}