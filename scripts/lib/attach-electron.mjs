// Attach only to a caller-selected local debugging port of our own SmartDD app.
export async function attachElectron(port) {
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find((p) => p.type === 'page');
  if (!page) throw new Error('SmartDD window not found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data); const request = pending.get(m.id); if (!request) return;
    clearTimeout(request.timer); pending.delete(m.id);
    if (m.error) request.reject(new Error('SmartDD operation failed; no sensitive parameters logged'));
    else request.resolve(m.result);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const seq = ++id; const timer = setTimeout(() => { pending.delete(seq); reject(new Error('SmartDD operation timed out')); }, 70_000);
    pending.set(seq, { resolve, reject, timer });
    ws.send(JSON.stringify({ id: seq, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error('SmartDD operation failed; no sensitive parameters logged');
    return result.result?.value;
  };
  const click = async (selector) => {
    const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    if (!point) throw new Error('SmartDD UI element not found');
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  };
  return { cdp, evaluate, click, invoke: (channel, ...args) => evaluate(`window.electronAPI.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`), close: () => ws.close() };
}
