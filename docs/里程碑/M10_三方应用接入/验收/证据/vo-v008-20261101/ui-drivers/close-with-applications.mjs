// Release-only cross regression: the original packaged UI saves M9 edits while
// closing a live M10-managed Codex session. Only this batch's synthetic data.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export async function checkCloseWithApplications({app,result,root,userData,task,project,click,key,screen,userEvents,poll,note}){
 const e=result.releaseCloseCross={status:'running',checks:[],layer:'A original M9 save/close UI and M10 native Codex/MCP lifecycle;loopback Responses only;synthetic file;no real model or business credentials'};
 const id=task.id,source=project.dirs[0].path,file=join(source,'release-close.txt'),base='Private release close base\n',saved='Private release close saved through UI\n';
 const check=name=>e.checks.push({name,at:new Date().toISOString()});
 const facts=async()=>{const t=await app.invoke('tasks.get',id),s=await app.invoke('applications.session',id);assert(s.ok);return{task:t,session:s.value};};
 await writeFile(file,base);e.before=await facts();
 await click('[data-testid=sidebar-task][data-task-id="'+id+'"]');
 await app.waitFor('document.querySelector("[data-testid=sidebar-task][aria-current=page]")?.getAttribute("data-task-id")==='+JSON.stringify(id));
 await click('[data-testid=task-actions]');await app.waitFor('!!document.querySelector("[data-testid=task-header-resume]")');await click('[data-testid=task-header-resume]');
 e.live=await poll(async()=>{const f=await facts();return f.task.ptyId&&f.session.currentRun?.bridge.connected?f:null;},30000);
 assert.equal(e.live.task.nativeSessionId,e.before.task.nativeSessionId);check('Original Codex session resumes with its fixed application and connected real MCP bridge');
 if(!await app.evaluate('document.querySelector("[data-testid=task-files]")?.getAttribute("aria-pressed")==="true"'))await click('[data-testid=task-files]');
 const selector='[role=treeitem]:is([data-file-path='+JSON.stringify(file)+'],[title='+JSON.stringify(file)+'])';
 await app.waitFor('!!document.querySelector('+JSON.stringify(selector)+')');await click(selector);
 const model='document.querySelector(".cm-content")?.cmTile?.root?.view?.state.doc.toString()';await app.waitFor(model+'==='+JSON.stringify(base));
 await click('.cm-content');await key('a','KeyA',65,4,['selectAll']);await app.cdp('Input.insertText',{text:saved});await app.waitFor(model+'==='+JSON.stringify(saved));assert.equal(await readFile(file,'utf8'),base);check('Actual editor input changes its document while the authoritative disk remains unchanged');
 e.noSubmitBefore={requests:result.requests.length,users:await userEvents()};
 await click('[data-testid=task-actions]');await app.waitFor('!!document.querySelector("[data-testid=task-close-session]")');await click('[data-testid=task-close-session]');await app.waitFor('!!document.querySelector("[data-testid=task-close-confirm]")');
 await click('[data-testid=task-close-cancel]');await app.waitFor('!document.querySelector("[data-testid=task-close-confirm]")');assert.equal((await facts()).task.ptyId,e.live.task.ptyId);assert.equal(await readFile(file,'utf8'),base);await app.waitFor(model+'==='+JSON.stringify(saved));check('Cancel preserves the live managed Codex process and unsaved M9 editor bytes');
 await click('[data-testid=task-actions]');await app.waitFor(`(()=>{const e=document.querySelector('[data-testid=task-close-session]');if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`,4000);await click('[data-testid=task-close-session]');await app.waitFor('!!document.querySelector("[data-testid=task-close-save]")');await click('[data-testid=task-close-save]');
 await app.waitFor('!document.querySelector("[data-testid=task-close-confirm]")',30000);
 e.after=await poll(async()=>{const f=await facts();return !f.task.ptyId&&!f.session.currentRun&&f.session.recentRuns.every(r=>r.state==='stopped'||r.state==='failed')?f:null;},30000);
 assert.equal(await readFile(file,'utf8'),saved);assert.equal(e.after.task.id,id);assert.equal(e.after.task.nativeSessionId,e.before.task.nativeSessionId);assert.equal(e.after.task.archivedAt,null);
 e.noSubmitAfter={requests:result.requests.length,users:await userEvents()};assert.deepEqual(e.noSubmitAfter,e.noSubmitBefore);e.savedSha256=createHash('sha256').update(await readFile(file)).digest('hex');
 check('Save and close writes the actual file, ends the exact managed Codex run, and retains native identity/history without extra model submission');
 await app.screenshot(join(root,'release-m9-m10-save-close.png'));await note('Release cross regression: M9 cancel/save-and-close interoperates with M10 managed Codex/MCP and preserves original task identity');e.status='passed';return e;
}
