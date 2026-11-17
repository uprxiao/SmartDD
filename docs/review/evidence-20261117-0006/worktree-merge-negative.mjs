// A private-copy export is added to access the original hostCheck body unchanged.
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const out=join(process.cwd(),'docs/review/evidence-20261117-0006');
const paths=JSON.parse(readFileSync(join(out,'private-run.json')));
process.argv[2]='worktree-negative';process.argv[3]='recheck';
const {hostCheck}=await import(join(paths.merge,'merge-agents.mjs'));
const dir=mkdtempSync('/private/tmp/m14-git-negative-'),repo=join(dir,'repo'),wt=join(dir,'wt');mkdirSync(repo);
const env={...process.env,GIT_AUTHOR_NAME:'review',GIT_AUTHOR_EMAIL:'review@example.test',GIT_COMMITTER_NAME:'review',GIT_COMMITTER_EMAIL:'review@example.test'};
const g=(cwd,...a)=>execFileSync('git',a,{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
g(repo,'init','-qb','main');writeFileSync(join(repo,'a.txt'),'base\n');g(repo,'add','-A');g(repo,'commit','-qm','base');const base=g(repo,'rev-parse','HEAD');
g(repo,'checkout','-qb','child');writeFileSync(join(repo,'child.txt'),'child\n');g(repo,'add','-A');g(repo,'commit','-qm','child result');
g(repo,'checkout','-q','main');g(repo,'merge','-q','child');
g(repo,'checkout','-qb','pending',base);writeFileSync(join(repo,'a.txt'),'pending\n');g(repo,'commit','-qam','pending conflicting change');const pending=g(repo,'rev-parse','HEAD');
g(repo,'checkout','-q','main');writeFileSync(join(repo,'a.txt'),'main\n');g(repo,'commit','-qam','main change');g(repo,'worktree','add','-qb','target',wt);
let conflict=false;try{g(wt,'cherry-pick',pending)}catch{conflict=true}
writeFileSync(join(wt,'a.txt'),'main\npending\n');g(wt,'add','a.txt');
const actualCherryPickHead=g(wt,'rev-parse','--git-path','CHERRY_PICK_HEAD');
const result={scope:'Original research hostCheck body, private linked Git worktree; no model/App',repo:wt,conflictInjected:conflict,
  gitPath:actualCherryPickHead,cherryPickStillInProgress:existsSync(actualCherryPickHead),gitStatus:g(wt,'status','--short'),check:hostCheck(wt,'child',base,'target')};
writeFileSync(join(out,'worktree-merge-negative.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
if(!result.cherryPickStillInProgress || !result.check.pass)throw Error('Counterexample did not reproduce');
