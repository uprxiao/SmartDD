// Exact error fields supplied by this frozen openElectron catch; private diagnostics only.
import{writeFile}from'node:fs/promises';
export async function saveStartupError(runtime,error,expected){
 const fields={};for(const key of['name','message','stack','code','errno','syscall','path','cdpMethod','cdpCode']){const v=error?.[key];if(v===null||['string','number','boolean'].includes(typeof v))fields[key]=v;}
 const source=error?.electronStartupProcess,process=source&&typeof source==='object'?Object.fromEntries(['pid','code','signal'].filter(k=>source[k]===null||['string','number'].includes(typeof source[k])).map(k=>[k,source[k]])):null;
 const hasLogs=typeof error?.electronStartupLogs==='string',logs=hasLogs?error.electronStartupLogs:null;
 const ports=hasLogs?[...new Set([...logs.matchAll(/(?:DevTools|Debugger) listening on ws:\/\/127\.0\.0\.1:(\d+)\//g)].map(m=>Number(m[1])).filter(p=>Number.isInteger(p)&&p>0&&p<=65535))]:[];
 const metadataPath=runtime+'/electron-startup-error.private.json',logsPath=hasLogs?runtime+'/electron-startup-stdio.private.log':null;
 await writeFile(metadataPath,JSON.stringify({at:new Date().toISOString(),fields,electronStartupProcess:process,expectedScope:expected,processIdentityBoundary:'PID/code/signal copied exactly from harness spawn-error field; no kernel identity or normal-exit assertion invented',hasElectronStartupLogs:hasLogs,logsPath,observedLoopbackDebugPorts:ports},null,2)+'\n',{flag:'wx',mode:0o600});
 if(hasLogs)await writeFile(logsPath,logs,{flag:'wx',mode:0o600});
 return{metadataPath,logsPath,hasLogs,logsBytes:hasLogs?Buffer.byteLength(logs):null,process,observedLoopbackDebugPorts:ports,source:'frozen-harness-error-electronStartupLogs/electronStartupProcess',normalExitProven:false};
}
