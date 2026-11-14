import { connect } from 'node:net';
import { appendFileSync } from 'node:fs';
const [port, token, output] = process.argv.slice(2);
const connection = connect(Number(port), '127.0.0.1');
connection.on('connect', () => connection.write(JSON.stringify({ token, event: 'ready', pid: process.pid, ppid: process.ppid }) + '\n'));
let pending = '';
connection.on('data', bytes => {
  pending += bytes;
  while (pending.includes('\n')) {
    const index = pending.indexOf('\n'), line = pending.slice(0, index); pending = pending.slice(index + 1);
    const command = JSON.parse(line);
    if (command.kind === 'write') {
      appendFileSync(output, command.id + '\n');
      connection.write(JSON.stringify({ event: 'written', id: command.id, pid: process.pid }) + '\n');
    } else if (command.kind === 'stop') {
      connection.end();
    }
  }
});
connection.on('end', () => connection.end());
connection.on('close', () => process.exit(0));
connection.on('error', () => process.exit(1));
