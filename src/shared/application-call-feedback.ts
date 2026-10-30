/** Presentation only: never authorizes, retries, restores or infers missing call evidence. */
export function recordedAttemptCount(value:unknown):number|null {
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
}
export function applicationCallFeedback(code:string,effectState:string|null|undefined,attempts:unknown):string {
 const count=recordedAttemptCount(attempts),record=count===null?'尝试次数未记录':'本次记录 '+count+' 次尝试';
 let reason='本次应用调用未完成',next='核对原连接条件和调用记录后，再明确下一步';
 if(effectState==='unknown'){reason='外部执行结果未知';next='先核实原执行，不自动重发';}
 else if(code==='AUTH_FAILED'||code==='AUTH_REQUIRED'){reason=code==='AUTH_FAILED'?'连接认证失败':'当前连接需要认证';next='检查原连接并重新认证，再明确发起新调用';}
 else if(code==='SCOPE_DENIED'){reason='当前调用没有所需授权';next='检查项目选用与连接授权，再明确发起新调用';}
 else if(code==='CANCELED'){reason='本次调用已取消';next='需要继续时，明确发起新调用';}
 else if(code==='SOURCE_BUSY'||code==='SOURCE_LOCKED'){reason='本地邮件来源暂时被占用';next='解除来源占用后，再明确发起新调用';}
 else if(code==='SOURCE_UNAVAILABLE'){reason='本地邮件来源暂不可读';next='检查原来源路径和读取权限，再明确发起新调用';}
 else if(['TRANSIENT_FAILURE','TIMEOUT','CONNECTION_UNAVAILABLE'].includes(code)){reason=code==='TIMEOUT'?'本次调用等待已结束':'临时服务或网络错误';next='核对原调用结果后，稍后明确发起新调用';}
 else if(code==='CONFIG_INCOMPATIBLE'||code==='CONFIG_COMPATIBILITY_UNVERIFIED'){reason='原版本配置兼容性需要核对';next='检查原版本与连接配置，保留原会话，再明确下一步';}
 else if(['HASH_MISMATCH','CAPABILITY_UNAVAILABLE','RESOURCE_RECOVERY_REQUIRED'].includes(code)){reason='原固定应用资源需要核查';next='检查并修复原资源，不替换原版本，再明确下一步';}
 else if(code==='SECRET_STORAGE_UNAVAILABLE'){reason='本机安全存储暂不可用';next='检查本机安全存储与原连接，再明确下一步';}
 return '最近调用：'+code+' · '+reason+'。'+record+'；'+next+'。';
}
