// Explicit result fault/latency gate around original PDFPageProxy.render in our App.
// The prototype is obtained from the real main-renderer call frame once; no fake
// page, Worker data, document state, media source or DOM input value is supplied.
export function startPdfPageRenderGate(app, { scriptUrl, line, first = 'reject' }) {
  let breakpoint, off, installed = false, error;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  void ready.catch(() => undefined);
  const readyTimer = setTimeout(() => { error = new Error('Original PDF page hook was not reached'); rejectReady(error); }, 15000);
  const setup = (async () => {
    await app.cdp('Debugger.enable');
    off = app.onCDP('Debugger.paused', async event => {
      if (installed || error || !event.hitBreakpoints?.includes(breakpoint)) return;
      try {
        const expression = `(()=>{const proto=Object.getPrototypeOf(page),original=proto.render,s={rows:[],gates:new Map(),armed:{type:${JSON.stringify(first)}},next:0,original,proto};
          s.wrapper=function(...args){const task=original.apply(this,args),canvas=args[0]?.canvas;if(!canvas?.closest('.fw-pdf-page:not(.fw-pdf-thumb)')||this.pageNumber!==1)return task;
            const row={id:++s.next,page:this.pageNumber,at:Date.now(),source:document.querySelector('.fw-tab.selected [role=tab]')?.title,canvas:new WeakRef(canvas),cancelCalls:0},mode=s.armed;s.rows.push(row);
            const result=task.promise.then(value=>{row.originalSettledAt=Date.now();row.originalUndefined=value===undefined;if(!mode||s.armed!==mode){row.deliveredAt=Date.now();return value}s.armed=null;row.mode=mode.type;
              if(mode.type==='reject'){row.injectedFailureAt=Date.now();throw new Error('DEV180 explicit page-render result failure')}
              return new Promise(resolve=>s.gates.set(row.id,()=>{row.deliveredAt=Date.now();row.deliveredUndefined=value===undefined;resolve(value);s.gates.delete(row.id)}));
            },failure=>{row.originalError=String(failure);throw failure});void result.catch(()=>undefined);
            if(!mode)return task;return new Proxy(task,{get(target,key){if(key==='promise')return result;if(key==='cancel')return(...values)=>{row.cancelCalls++;return target.cancel(...values)};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value}});
          };proto.render=s.wrapper;
          s.snapshot=()=>({armed:s.armed?.type,held:[...s.gates.keys()],rows:s.rows.map(({canvas,...row})=>{const c=canvas.deref();return{...row,canvas:c?{connected:c.isConnected,width:c.width,height:c.height,rendered:c.dataset.rendered}:null}})});
          s.restore=()=>{for(const release of[...s.gates.values()])release();proto.render=original;return proto.render===original};window.__pdfPageRenderGate=s;return{installed:true,page:page.pageNumber,prototype:proto.constructor.name}})()`;
        const out = await app.cdp('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId, expression, returnByValue: true });
        if (out.exceptionDetails) throw Error(out.exceptionDetails.exception?.description || 'Page render gate failed');
        installed = true; clearTimeout(readyTimer); await app.cdp('Debugger.removeBreakpoint', { breakpointId: breakpoint }); await app.cdp('Debugger.resume'); resolveReady(out.result.value);
      } catch (failure) { error = failure; clearTimeout(readyTimer); try { await app.cdp('Debugger.resume'); } catch {} rejectReady(failure); }
    });
    const out = await app.cdp('Debugger.setBreakpointByUrl', { url: scriptUrl, lineNumber: line - 1, condition: 'page.pageNumber === 1' }); breakpoint = out.breakpointId;
  })();
  return {
    setup, ready,
    arm: async type => { await ready; return app.evaluate(`(()=>{const s=window.__pdfPageRenderGate;if(s.armed||s.gates.size)throw Error('Previous render gate still active');s.armed={type:${JSON.stringify(type)}};return true})()`); },
    snapshot: async () => installed ? app.evaluate('window.__pdfPageRenderGate.snapshot()') : ({ installed: false, error: error && String(error) }),
    release: async id => app.evaluate(`(()=>{const fn=window.__pdfPageRenderGate.gates.get(${id});if(!fn)throw Error('Missing original render result');fn();return true})()`),
    async close() {
      let restored = !installed;
      clearTimeout(readyTimer);
      if (installed) restored = await app.evaluate('window.__pdfPageRenderGate.restore()');
      if (breakpoint) try { await app.cdp('Debugger.removeBreakpoint', { breakpointId: breakpoint }); } catch {}
      off?.(); await app.cdp('Debugger.disable');
      if (installed) await app.evaluate('delete window.__pdfPageRenderGate');
      return { installed, restored, error: error && String(error) };
    },
  };
}
