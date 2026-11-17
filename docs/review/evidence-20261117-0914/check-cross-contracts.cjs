// Requirement-oriented counterexamples. A nonzero exit is expected on this reviewed snapshot.
const fs=require('node:fs'),path=require('node:path');
const data=JSON.parse(fs.readFileSync(path.join(__dirname,'cross-artifact-probes.json'),'utf8'));
const by=Object.fromEntries(data.cases.map(x=>[x.name,x]));
const checks=[];
const check=(id,expected,actual,pass)=>checks.push({id,expected,actual,status:pass?'passed':'failed'});
for(const row of by['permission-sources'].matrix)check('same-menu-'+row.tool,row.home,row.task,JSON.stringify(row.home)===JSON.stringify(row.task));
const draft=by['ordinary-draft-as-approval-reason'];
check('approval-preserves-message-draft',draft.textBefore,draft.draftAfter,draft.textBefore===draft.draftAfter);
const reason=by['request-reason-scope'];check('request-reason-isolation','',''+reason.textarea,!reason.textarea);
const ext=by['extension-home-to-new-task'];check('home-extension-choice-carries',false,ext.newTaskChecked,ext.newTaskChecked===false);
const mail=by['agent-mail-edit-revision'], versions=[mail.before,mail.afterOne,mail.afterTwo].map(x=>`${x.id}:${x.mailRevision??1}`);
check('agent-edit-rotates-review-revision','different request/review revision after each edit',versions,new Set(versions).size===3);
const term=by['code-to-terminal'];check('terminal-code-is-prefilled',true,term.sentCodeVisible,term.sentCodeVisible);
const plan=by['codex-plan-mapping'];check('codex-does-not-generate-plan-card',false,plan.actual.some(x=>x.type==='proposed_plan'),!plan.actual.some(x=>x.type==='proposed_plan'));
fs.writeFileSync(path.join(__dirname,'cross-contract-checks.json'),JSON.stringify({scope:data.scope,checks,failed:checks.filter(x=>x.status==='failed').length},null,2)+'\n');
console.log(JSON.stringify({checks:checks.length,failed:checks.filter(x=>x.status==='failed').length}));
process.exitCode=checks.some(x=>x.status==='failed')?1:0;
