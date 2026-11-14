import { spawnClaudeProcessGroup } from './extracted.mjs';
const [port, token, output, marker] = process.argv.slice(2);
const child = spawnClaudeProcessGroup({ command: process.execPath, args: [new URL('./root.mjs', import.meta.url).pathname, 'ordinary', port, token, output, marker], cwd: new URL('.', import.meta.url).pathname, env: process.env },
  () => process.exit(0), () => {}, () => {}, pid => { process.stdout.write(JSON.stringify({ event: 'registered', pid }) + '\n'); return () => {}; });
child.stdout.resume();
child.on('error', error => { process.stderr.write(String(error)); process.exit(1); });
process.stdin.resume();
