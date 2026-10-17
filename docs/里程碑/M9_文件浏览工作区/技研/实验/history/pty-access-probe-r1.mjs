#!/usr/bin/env node
// Real Electron sender/frame IPC + a synthetic raw-mode PTY. No user's app,
// database, CLI, model, profile or Codex session is loaded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(here), '../../../../..');
const require = createRequire(path.join(repo, 'package.json'));
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild');
const output = process.argv[process.argv.indexOf('--output') + 1];
if (!output || output.startsWith('--')) throw new Error('--output required');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-native-pty-access-'));
const resultPath = path.join(temp, 'result.json');
const code = `
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'); const path=require('node:path');
const pty=require('node:module').createRequire(${JSON.stringify(path.join(repo, 'package.json'))})('node-pty');
const {PtyAccess,registerPtyInput,createPtyController}=require(${JSON.stringify(path.join(repo,'src/main/pty-access.ts'))});
const {registerRPCRouter}=require(${JSON.stringify(path.join(repo,'src/shared/ipc/rpc.ts'))});
const root=${JSON.stringify(temp)}; app.setPath('userData',path.join(root,'profile'));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await wait(30);}throw Error('timeout');};
let terminal; const windows=[]; const cases=[];
const check=async(id,title,fn)=>{try{const evidence=await fn();cases.push({id,title,status:'passed',evidence});}catch(e){cases.push({id,title,status:'failed',error:String(e.stack||e)});}};
const assert=(x,m)=>{if(!x)throw Error(m)};
app.whenReady().then(async()=>{
  let bytes=''; let written=0; let resized=0; let killed=0; let active='owned';
  terminal=pty.spawn(${JSON.stringify(process.execPath)},['-e',"process.stdin.setRawMode(true);process.stdout.write('READY\\n');process.stdin.on('data',d=>process.stdout.write('GOT:'+d.toString('base64')+'\\n'));setInterval(()=>{},1000)"],{cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',TERM:'xterm-256color'},cols:80,rows:24});
  terminal.onData(d=>bytes+=d); await until(()=>bytes.includes('READY'));
  fs.writeFileSync(path.join(root,'preload.cjs'),"const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('qa',{send:v=>ipcRenderer.send('pty:input',v),resize:v=>ipcRenderer.send('pty:resize',v),kill:(t,p)=>ipcRenderer.invoke('pty.kill',t,p)});");
  fs.writeFileSync(path.join(root,'child.html'),'<p>synthetic child</p>');
  fs.writeFileSync(path.join(root,'index.html'),'<p>synthetic main</p><iframe src="child.html"></iframe>');
  const make=async()=>{const w=new BrowserWindow({show:false,webPreferences:{preload:path.join(root,'preload.cjs'),contextIsolation:true,nodeIntegration:false,nodeIntegrationInSubFrames:true,sandbox:false}});windows.push(w);await w.loadFile(path.join(root,'index.html'));return w;};
  const main=await make(); const other=await make(); const expected=main.webContents.getURL();
  const access=new PtyAccess({trusted:e=>e.sender===main.webContents&&e.senderFrame.url===expected,activePty:t=>t==='task'?active:null,alive:p=>p==='owned',write:(p,d)=>{written++;terminal.write(d);},resize:(p,c,r)=>{resized++;terminal.resize(c,r);},killTask:t=>{killed++;active=null;terminal.kill();}});
  const off=registerPtyInput(ipcMain,access);registerRPCRouter({pty:createPtyController(access)},ipcMain);
  const payload={taskId:'task',ptyId:'owned',data:'输入 😀'};
  await check('PA01','真实Electron主frame经生产校验送入真实PTY，不追加Enter',async()=>{await main.webContents.executeJavaScript('qa.send('+JSON.stringify(payload)+')');await until(()=>bytes.includes('GOT:'));const encoded=bytes.match(/GOT:([^\\r\\n]+)/)[1];const got=Buffer.from(encoded,'base64').toString();assert(got===payload.data,'PTY bytes mismatch');assert(written===1,'write count');return {received:got,appendEnter:false};});
  await check('PA02','另一个真实窗口即使知道task/PTY也不能输入',async()=>{await other.webContents.executeJavaScript('qa.send('+JSON.stringify(payload)+')');await wait(100);assert(written===1,'foreign window wrote');return {rejected:true};});
  await check('PA03','真实子frame同一webContents仍被拒绝',async()=>{const child=main.webContents.mainFrame.frames.find(f=>f.url.endsWith('child.html'));assert(child,'no child');await child.executeJavaScript('qa.send('+JSON.stringify(payload)+')');await wait(100);assert(written===1,'child wrote');return {rejected:true};});
  await check('PA04','错任务及停止/重开后的旧PTY不能输入',async()=>{await main.webContents.executeJavaScript('qa.send('+JSON.stringify({...payload,taskId:'wrong'})+')');active='new-pty';await main.webContents.executeJavaScript('qa.send('+JSON.stringify(payload)+')');await wait(100);assert(written===1,'stale/mismatched wrote');active='owned';return {rejected:true};});
  await check('PA05','真实resize仅接受合法来源/任务和尺寸',async()=>{await main.webContents.executeJavaScript('qa.resize('+JSON.stringify({...payload,cols:100,rows:35})+')');await other.webContents.executeJavaScript('qa.resize('+JSON.stringify({...payload,cols:120,rows:40})+')');await main.webContents.executeJavaScript('qa.resize('+JSON.stringify({...payload,cols:-1,rows:35})+')');await wait(100);assert(resized===1&&terminal.cols===100&&terminal.rows===35,'resize leak');return {cols:terminal.cols,rows:terminal.rows,rejectedOther:2};});
  await check('PA06','原生invoke的kill校验sender/task，合法调用只结束合成PTY',async()=>{const rejected=await other.webContents.executeJavaScript("qa.kill('task','owned').then(()=>false,()=>true)");assert(rejected&&killed===0,'foreign kill');const wrong=await main.webContents.executeJavaScript("qa.kill('wrong','owned').then(()=>false,()=>true)");assert(wrong&&killed===0,'wrong task kill');await main.webContents.executeJavaScript("qa.kill('task','owned')");assert(killed===1,'legitimate kill failed');return {foreignAndWrongTaskRejected:true,legitimateKill:true};});
  off(); fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({electron:process.versions.electron,platform:process.platform,arch:process.arch,cases,scope:'Own hidden Electron windows and synthetic raw PTY; not packaged WillYou or third-party CLI acceptance'},null,2));
}).catch(e=>{fs.writeFileSync(${JSON.stringify(resultPath)},JSON.stringify({fatal:String(e.stack||e)}));}).finally(()=>{try{terminal?.kill()}catch{};for(const w of windows)if(!w.isDestroyed())w.destroy();app.quit();});
`;
try {
  await build({ stdin: { contents: code, resolveDir: repo, loader: 'ts' }, outfile: path.join(temp, 'probe.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], alias: { '@shared': path.join(repo, 'src/shared') }, logLevel: 'silent' });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync(require('electron'), [path.join(temp, 'probe.cjs')], { env, timeout: 45000, encoding: 'utf8' });
  const result = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath,'utf8')) : { fatal: 'no result', exitCode: run.status, stderr: run.stderr?.slice(-2000) };
  result.startedFromScript = here;
  result.scriptSha256 = crypto.createHash('sha256').update(fs.readFileSync(here)).digest('hex');
  result.summary = { passed: result.cases?.filter(x=>x.status==='passed').length ?? 0, failed: result.fatal ? 1 : result.cases?.filter(x=>x.status==='failed').length ?? 0 };
  fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result.summary)); process.exitCode = result.summary.failed ? 1 : 0;
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
