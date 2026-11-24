import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixtureLogin, startReportFixture } from './report-fixture.mjs';

async function signIn(scenario) {
  const reply = await fetch(scenario.url('login'), {
    method: 'POST', body: new URLSearchParams(fixtureLogin), redirect: 'manual',
  });
  assert.equal(reply.status, 303);
  assert.equal(new URL(reply.headers.get('location'), scenario.url('desk')).href, scenario.url('desk'));
  const cookie = reply.headers.get('set-cookie');
  assert(cookie?.includes('HttpOnly'));
  return cookie.split(';')[0];
}

const open = (scenario, route, cookie) => fetch(scenario.url(route), {
  headers: cookie ? { cookie } : {}, redirect: 'manual',
});

const generate = (scenario, cookie, month = '11') => fetch(scenario.url('generate'), {
  method: 'POST', body: new URLSearchParams({ month }), headers: { cookie }, redirect: 'manual',
});

async function withScenario(testCase, key, fn) {
  const fixture = await startReportFixture();
  testCase.after(() => fixture.close());
  const scenario = fixture.create(key);
  await fn(scenario, fixture);
  assert.deepEqual(fixture.errors, []);
}

test('the actual request can arrive while its response stays held', async t => {
  await withScenario(t, 'held-navigation', async scenario => {
    let release;
    scenario.controls.openGate = new Promise(resolve => { release = resolve; });
    const request = open(scenario, 'open');
    try {
      const deadline = performance.now() + 1000;
      while (!scenario.visits.some(x => x.route === 'open')) {
        assert(performance.now() < deadline, 'local server must receive the open request');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(scenario.visits[0].finishedAt, undefined);
    } finally { release(); }
    assert.match(await (await request).text(), /id="fixture-ready"/);
    assert.equal(scenario.visits.filter(x => x.route === 'open').length, 1);
  });
});

test('same identity can read the business marker and an independent identity reaches login', async t => {
  await withScenario(t, 'first-and-expired', async scenario => {
    assert.equal((await open(scenario, 'desk')).status, 303);
    const cookie = await signIn(scenario);
    assert.match(await (await open(scenario, 'desk', cookie)).text(), /id="business-ready"/);
    assert.equal((await open(scenario, 'desk')).status, 303);
    scenario.expire();
    assert.equal((await open(scenario, 'desk', cookie)).status, 303);
    const next = await signIn(scenario);
    assert.notEqual(cookie, next);
    assert.match(await (await open(scenario, 'desk', next)).text(), /id="business-ready"/);
    assert.equal(scenario.counters.logins, 2);
    assert.equal(scenario.counters.writes, 0);
  });
});

test('Basic authentication has a real challenge and business identifier', async t => {
  await withScenario(t, 'basic-login', async scenario => {
    const authStart = await (await open(scenario, 'auth-start')).text();
    assert.match(authStart, /href="desk" target="_blank"/);
    assert.equal((await open(scenario,'desk')).status,303);
    const challenge = await open(scenario, 'basic');
    assert.equal(challenge.status, 401);
    assert.match(challenge.headers.get('www-authenticate'), /^Basic /);
    const authorization = 'Basic ' + Buffer.from(fixtureLogin.account + ':' + fixtureLogin.password).toString('base64');
    const ready = await fetch(scenario.url('basic'), { headers:{ authorization } });
    assert.match(await ready.text(), /id="basic-ok"/);
  });
});

test('changed and invalid entrances lead through discoverable help to the report and popup', async t => {
  await withScenario(t, 'moved-layout', async scenario => {
    const cookie = await signIn(scenario);
    scenario.controls.layout = 'moved';
    const desk = await (await open(scenario, 'desk', cookie)).text();
    assert.match(desk, /href="help"/);
    assert.match(desk, /href="details" target="_blank"/);
    assert.match(await (await open(scenario, 'details', cookie)).text(), /id="report-details"/);
    assert.match(await (await open(scenario, 'help', cookie)).text(), /href="report"/);
    scenario.controls.ambiguousReport = true;
    const report = await (await open(scenario, 'report', cookie)).text();
    assert.equal((report.match(/>生成报表<\/button>/g) ?? []).length,2);
    assert.match(report, /id="replace-report"/);
    scenario.controls.layout = 'invalid';
    assert.match(await (await open(scenario, 'desk', cookie)).text(), /href="legacy"/);
    assert.match(await (await open(scenario, 'legacy', cookie)).text(), /旧入口已迁移.*href="help"/);
  });
});

test('report rejection, content verification and damaged artifact are distinct observable results', async t => {
  await withScenario(t, 'artifact', async scenario => {
    const cookie = await signIn(scenario);
    assert.equal((await generate(scenario, cookie, '10')).status, 422);
    scenario.controls.rejectWrite = true;
    assert.equal((await generate(scenario, cookie)).status, 422);
    scenario.controls.rejectWrite = false;
    assert.deepEqual(await (await generate(scenario, cookie)).json(), { id:'artifact-1', month:'11' });
    const result = await open(scenario, 'csv', cookie);
    assert.match(result.headers.get('content-disposition'), /artifact-1\.csv/);
    assert.equal(await result.text(),'id,month\nartifact-1,11\n');
    scenario.controls.badCsv = true;
    assert.equal(await (await open(scenario, 'csv', cookie)).text(),'id,month\nwrong,10\n');
    assert.equal(scenario.counters.rejectedWrites,2);
    assert.equal(scenario.counters.writes,1);
    assert.equal(scenario.counters.downloads,2);
  });
});

test('a truncated write response is reconciled through the original read path and tracks every write', async t => {
  await withScenario(t, 'unknown-write', async scenario => {
    const cookie = await signIn(scenario);
    scenario.controls.truncateWriteResponse = true;
    await assert.rejects(async () => (await generate(scenario,cookie)).json());
    assert.equal(scenario.counters.writes,1);
    scenario.controls.receiptVisible = false;
    assert.equal((await open(scenario,'receipt',cookie)).status,503);
    assert.equal(scenario.counters.writes,1);
    scenario.controls.receiptVisible = true;
    const receipt = await (await open(scenario,'receipt',cookie)).text();
    assert.equal((receipt.match(/data-record=/g) ?? []).length,1);
    assert.match(receipt,/data-record="unknown-write-1"/);
    assert.equal(scenario.counters.writes,1);
    assert.deepEqual(scenario.records,[{id:'unknown-write-1',month:'11'}]);
  });
});

test('an unavailable page and duplicated fixture ID do not silently appear successful', async t => {
  await withScenario(t, 'load-failure', async (scenario, fixture) => {
    assert.throws(() => fixture.create('load-failure'), /unique ID/);
    scenario.controls.openFailure = true;
    await assert.rejects(() => open(scenario,'open'));
    assert(scenario.visits.some(visit=>visit.route==='open' && !visit.finishedAt));
    scenario.controls.openFailure = false;
    assert.match(await (await open(scenario,'open')).text(),/id="fixture-ready"/);
  });
});
