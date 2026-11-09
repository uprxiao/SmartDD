import assert from'node:assert/strict';
export function makeLiveBindingBody({taskId,runId}){
 assert(typeof taskId==='string'&&typeof runId==='string');
 return `const req=process.getBuiltinModule('module').createRequire(process.resourcesPath+'/app.asar/package.json'),DB=req('better-sqlite3'),db=new DB(E.app.getPath('userData')+'/smartdd.db',{readonly:true,fileMustExist:true});let row;try{db.pragma('query_only=ON');row=db.prepare('SELECT run_id,task_id,pid,pty_id FROM capability_runs WHERE run_id=? AND task_id=?').get(${JSON.stringify(runId)},${JSON.stringify(taskId)});}finally{db.close();}if(!row||!Number.isSafeInteger(row.pid)||row.pid<=1)throw Error('Exact own managed run PID unavailable');const kernel=process.getBuiltinModule('child_process').execFileSync('/bin/ps',['-ww','-p',String(row.pid),'-o','pid=,ppid=,lstart=,comm='],{encoding:'utf8',timeout:3000});if(!kernel.trim())throw Error('Original managed process unavailable');return{taskId:row.task_id,runId:row.run_id,ptyId:row.pty_id,pid:row.pid,kernel};`;
}
export function verifySameLiveBinding(before,after,expected){
 for(const v of[before,after]){assert.equal(v.taskId,expected.taskId);assert.equal(v.runId,expected.runId);assert.equal(v.ptyId,expected.ptyId);assert(Number.isSafeInteger(v.pid)&&v.pid>1);assert(typeof v.kernel==='string'&&v.kernel.trim());}
 assert.equal(after.pid,before.pid);assert.equal(after.kernel,before.kernel);
 return{verified:true,taskId:after.taskId,runId:after.runId,ptyId:after.ptyId,pid:after.pid,sameKernelBirthAndExecutable:true,source:'Actual own committed run row and exact PID ps before/after once real UI binding; no new run or process'};
}
