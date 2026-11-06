// Exact existing Client protocol path; fixed binary and graceful EOF before recorded fallback signals.
import{spawn}from'node:child_process';import{createInterface}from'node:readline';
const CLI_BINARY="/Users/liubu/.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex";
export class Client {
  constructor(label, args, cwd, env) {
    this.label = label; this.id = 0; this.pending = new Map(); this.methods = []; this.notifications = []; this.unexpectedRequests = []; this.stderr = '';
    this.child = spawn(CLI_BINARY, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.on('error',error=>{this.spawnErrorType=error.name;});
    this.exit = new Promise((r) => this.child.once('exit', r));
    this.child.stderr.on('data', (d) => this.stderr += d);
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', (line) => {
      let x; try { x = JSON.parse(line); } catch { return; }
      this.onMessage?.(x);
      if (x.method) {
        this.notifications.push(x.method);
        if (x.id !== undefined) { this.unexpectedRequests.push(x.method); this.child.stdin.write(JSON.stringify({ id: x.id, error: { code: -32601, message: 'Probe rejects unexpected interactive request' } }) + '\n'); }
        return;
      }
      const p = this.pending.get(x.id); if (!p) return;
      this.pending.delete(x.id); clearTimeout(p.timer); x.error ? p.reject(new Error(JSON.stringify(x.error))) : p.resolve(x.result);
    });
  }
  rpc(method, params) {
    this.methods.push(method); const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.label} ${method} timeout`)); }, 15000);
      this.pending.set(id, { resolve, reject, timer }); this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }
  async close() {
    if(this.closed)return;this.closed=true;this.signals=[];
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('closed'));}this.pending.clear();
    const wait=async ms=>{let timer;try{await Promise.race([this.exit,new Promise(r=>timer=setTimeout(r,ms))]);}finally{clearTimeout(timer);}};
    this.child.stdin.end();await wait(5000);
    if(this.child.exitCode===null&&this.child.signalCode===null){this.signals.push('SIGTERM');this.child.kill('SIGTERM');await wait(2000);}
    if(this.child.exitCode===null&&this.child.signalCode===null){this.signals.push('SIGKILL');this.child.kill('SIGKILL');await wait(2000);}
    this.lines.close();this.exitReceipt={pid:this.child.pid,code:this.child.exitCode,signal:this.child.signalCode,signals:this.signals,normalEOF:this.signals.length===0};
  }
}
