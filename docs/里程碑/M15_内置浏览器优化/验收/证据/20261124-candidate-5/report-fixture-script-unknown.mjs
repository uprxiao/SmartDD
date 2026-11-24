import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';

export const fixtureLogin = Object.freeze({ account: 'm15-test-user', password: 'm15-test-password' });
const reportMonth = '11';
const basicAuthorization = 'Basic ' + Buffer.from(fixtureLogin.account + ':' + fixtureLogin.password).toString('base64');

function html(response, title, body) {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><meta charset="utf-8"><title>' + title + '</title>' + body);
}

async function fields(request) {
  let text = '';
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 8192) throw new Error('Fixture form exceeded its size limit');
  }
  return new URLSearchParams(text);
}

export async function startReportFixture() {
  const scenarios = new Map();
  const errors = [];
  const server = createServer(async (request, response) => {
    try {
      response.setHeader('Cache-Control', 'no-store');
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      const [, key, route] = path.split('/');
      const scenario = scenarios.get(key);
      if (!scenario || path !== `/${key}/${route}`) {
        response.writeHead(404).end('Fixture route missing');
        return;
      }
      const { counters, controls, prefix } = scenario;
      const visit = { route, method: request.method, receivedAt: performance.timeOrigin + performance.now() };
      scenario.visits.push(visit);
      response.once('finish', () => { visit.finishedAt = performance.timeOrigin + performance.now(); });
      response.once('close', () => { if (!visit.finishedAt) visit.closedBeforeFinish = true; });
      const redirect = target => response.writeHead(303, { Location: prefix + target }).end();
      const loggedIn = scenario.session !== null && (request.headers.cookie ?? '').split(/;\s*/).includes('m15_session=' + scenario.session);
      if (request.method === 'GET' && route === 'open') {
        if (controls.openGate) await controls.openGate;
        if (response.destroyed) return;
        if (controls.openFailure) { response.destroy(); return; }
        html(response, 'M15 ' + key, '<main><h1 id="fixture-ready">M15 测试网页</h1><button id="available">可操作</button></main>');
      } else if (route === 'auth-start' && request.method === 'GET') {
        html(response, '站点认证入口', '<h1>站点认证</h1><a href="desk" target="_blank">在弹窗中登录</a>');
      } else if (route === 'login' && request.method === 'GET') {
        html(response, '登录', '<h1>请登录</h1><form method="post"><label>账号<input name="account"></label><label>密码<input name="password" type="password"></label><button>登录</button></form>');
      } else if (route === 'login' && request.method === 'POST') {
        const input = await fields(request);
        if (input.get('account') !== fixtureLogin.account || input.get('password') !== fixtureLogin.password) {
          response.writeHead(403).end('Fixture login rejected');
          return;
        }
        counters.logins++;
        scenario.session = randomUUID();
        response.setHeader('Set-Cookie', `m15_session=${scenario.session}; Path=${prefix}; HttpOnly; SameSite=Lax`);
        redirect('desk');
      } else if (route === 'basic' && request.method === 'GET') {
        if (request.headers.authorization !== basicAuthorization) {
          response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="M15 synthetic"' }).end('Authentication fixture');
          return;
        }
        html(response, '认证完成', '<h1 id="basic-ok">认证完成</h1>');
      } else if (!loggedIn) {
        redirect('login');
      } else if (route === 'desk' && request.method === 'GET') {
        const entry = { direct: '<a href="report">月度报表</a>', moved: '<a href="help">查找导出功能</a>', invalid: '<a href="legacy">月度报表</a>' }[controls.layout];
        html(response,'报表中心', '<h1 id="business-ready">报表中心</h1>'+entry+
          '<button id="report-write">生成合成报表</button><p id="script-held" role="status"></p>'+
          '<script>document.querySelector("#report-write").onclick=async()=>{const status=document.querySelector("#script-held");try{const response=await fetch("generate",{method:"POST",body:new URLSearchParams({month:"11"})});await response.json();status.textContent="已收到";}catch{status.textContent="结果待核对";}};</script>');

      } else if (route === 'legacy' && request.method === 'GET') {
        html(response, '入口已迁移', '<h1>旧入口已迁移</h1><a href="help">站内帮助</a>');
      } else if (route === 'help' && request.method === 'GET') {
        html(response, '站内帮助', '<h1>站内帮助</h1><p>在报表工作台生成月份报表。</p><a href="report">报表工作台</a>');
      } else if (route === 'report' && request.method === 'GET') {
        const duplicate = controls.ambiguousReport ? '<aside aria-label="其他报表"><button disabled>生成报表</button></aside>' : '';
        html(response, '报表工作台', `<h1>报表工作台</h1><form aria-label="月度报表"><label>月份<select name="month" size="2"><option value="10">十月</option><option value="11">十一月</option></select></label><button>生成报表</button></form>${duplicate}<button id="replace-report">刷新表单</button><p role="status"></p><a href="receipt">核对结果</a><script>
          const status = document.querySelector('[role=status]');
          document.querySelector('#replace-report').addEventListener('click', () => {
            const old = document.querySelector('form button');
            old.replaceWith(old.cloneNode(true));
          });
          document.querySelector('form').addEventListener('submit', async event => {
            event.preventDefault();
            try {
              const reply = await fetch('generate', { method: 'POST', body: new URLSearchParams(new FormData(event.currentTarget)) });
              const record = await reply.json();
              if (!reply.ok) throw new Error('生成失败');
              status.textContent = '报表已生成 ' + record.id;
              const link = document.createElement('a');
              link.href = 'csv';
              link.textContent = '下载 CSV';
              status.after(link);
            } catch {
              status.textContent = '生成结果待核对';
            }
          });
        </script>`);
      } else if (route === 'generate' && request.method === 'POST') {
        const input = await fields(request);
        if (input.get('month') !== reportMonth || controls.rejectWrite) {
          counters.rejectedWrites++;
          response.writeHead(422, { 'Content-Type': 'application/json' }).end('{"error":"report rejected"}');
          return;
        }
        counters.writes++;
        const record = { id: key + '-' + counters.writes, month: reportMonth };
        scenario.records.push(record);
        if (controls.truncateWriteResponse) {
          response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1000', Connection: 'close' }).end('{"id":');
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(record));
      } else if (route === 'receipt' && request.method === 'GET') {
        counters.receiptReads++;
        if (!controls.receiptVisible) {
          response.writeHead(503).end('Fixture receipt temporarily unavailable');
          return;
        }
        html(response, '生成记录', '<h1>生成记录</h1><ul>' + scenario.records.map(record => `<li data-record="${record.id}">${record.id} ${record.month}</li>`).join('') + '</ul><a href="csv">下载 CSV</a>');
      } else if (route === 'csv' && request.method === 'GET') {
        const record = scenario.records.at(-1);
        if (!record) { response.writeHead(404).end('No report'); return; }
        counters.downloads++;
        response.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${record.id}.csv"` });
        response.end(controls.badCsv ? 'id,month\nwrong,10\n' : `id,month\n${record.id},${record.month}\n`);
      } else if (route === 'details' && request.method === 'GET') {
        html(response, '业务详情', '<h1 id="report-details">业务详情</h1>');
      } else {
        response.writeHead(404).end('Fixture route missing');
      }
    } catch (error) {
      errors.push(String(error));
      if (!response.headersSent) response.writeHead(500);
      response.end('Fixture handler failed');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  return {
    origin,
    errors,
    create(key, { layout = 'direct' } = {}) {
      assert.match(key, /^[a-z0-9][a-z0-9-]{0,47}$/);
      assert(['direct', 'moved', 'invalid'].includes(layout));
      assert(!scenarios.has(key), 'Fixture scenario must have a unique ID');
      const scenario = {
        prefix: '/' + key + '/',
        session: null,
        controls: { layout, receiptVisible: true },
        counters: { logins: 0, writes: 0, rejectedWrites: 0, receiptReads: 0, downloads: 0 },
        visits: [],
        records: [],
      };
      scenarios.set(key, scenario);
      return {
        url: route => origin + scenario.prefix + route,
        controls: scenario.controls,
        counters: scenario.counters,
        visits: scenario.visits,
        records: scenario.records,
        expire() { scenario.session = null; },
      };
    },
    async close() {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
