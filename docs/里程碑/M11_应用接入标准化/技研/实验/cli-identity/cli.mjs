// 实验用 CLI：只从环境取令牌与通道，不接受令牌参数；stdout 输出 JSON，诊断走 stderr。
import { connect } from 'node:net';
const [, , op, ...rest] = process.argv;
const project = rest.includes('--project') ? rest[rest.indexOf('--project') + 1] : undefined;
const token = process.env.WILLYOU_RUN_TOKEN, endpoint = process.env.WILLYOU_ENDPOINT;
if (!token || !endpoint) { process.stderr.write('missing managed context\n'); process.exit(3); }
const s = connect(endpoint); let out = '';
s.on('connect', () => s.write(JSON.stringify({ op, token, project }) + '\n'));
s.on('data', d => out += d);
s.on('error', e => { process.stderr.write('channel error: ' + e.code + '\n'); process.exit(4); });
s.on('close', () => { const r = JSON.parse(out); process.stdout.write(JSON.stringify(r) + '\n'); process.exit(r.ok ? 0 : 2); });
