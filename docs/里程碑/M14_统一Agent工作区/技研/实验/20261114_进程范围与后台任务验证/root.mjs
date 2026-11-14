import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const [mode, port, token, output, marker] = process.argv.slice(2);
writeFileSync(marker, 'root-started');
const child = spawn(process.execPath, [new URL('./writer.mjs', import.meta.url).pathname, port, token, output], {
  detached: mode === 'escaped', stdio: mode === 'escaped' ? 'ignore' : ['ignore', 'inherit', 'inherit'],
});
child.on('error', error => { process.stderr.write(String(error)); process.exit(1); });
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => { if (data.includes('exit')) process.exit(0); });
process.stdin.resume();
