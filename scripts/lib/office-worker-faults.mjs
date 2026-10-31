// One-shot launch faults in an owned App only. No source/authority/results change.
export async function installOfficeWorkerFaults(app) {
  return app.mainEvaluate(`(()=>{const module=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('node:worker_threads'),Base=module.Worker,s={next:null,rows:[]};const Wrapped=new Proxy(Base,{construct(target,args,newTarget){if(s.next&&String(args[0]).endsWith('/'+s.next.workerName)){const fault=s.next;s.next=null;s.rows.push({at:Date.now(),original:String(args[0]),redirected:fault.path,kind:fault.kind,options:args[1],boundary:'Only Worker entry redirected to owned missing entry/import bootstrap. Options, source bytes, authority and original error handling unchanged.'});args=[fault.path,...args.slice(1)];}return Reflect.construct(target,args,newTarget===Wrapped?target:newTarget);}});globalThis.__officeWorkerFaults={module,Base,Wrapped,s};module.Worker=Wrapped;return module.Worker===Wrapped})()`);
}
export const armOfficeWorkerFault = (app, path, kind, workerName = 'm9-office-pages.js') => {
  if (!['m9-office-pages.js', 'm9-office-document.js', 'm9-pptx-document.js'].includes(workerName)) throw Error('Unknown Office Worker');
  return app.mainEvaluate(`(()=>{const s=globalThis.__officeWorkerFaults.s;if(s.next)throw Error('An Office launch fault is already armed');s.next=${JSON.stringify({path,kind,workerName})};return true})()`);
};
export const observeOfficeWorkerFaults = app => app.mainEvaluate('globalThis.__officeWorkerFaults.s');
export async function restoreOfficeWorkerFaults(app) {
  return app.mainEvaluate('(()=>{const o=globalThis.__officeWorkerFaults;o.s.next=null;o.module.Worker=o.Base;const result={restored:o.module.Worker===o.Base,rows:o.s.rows};delete globalThis.__officeWorkerFaults;return result})()');
}
