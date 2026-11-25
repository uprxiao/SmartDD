import {LedgerCandidate} from './ledger-candidate.mjs';
const [file,mode,id,when,runId]=process.argv.slice(2),now=Number(when);
const l=new LedgerCandidate(file);
let result;
if(mode==='claim')result=l.claim(id,{now});
else{
  const run=l.begin(runId,now);
  if(mode==='receipt'){
    l.db.exec('CREATE TABLE IF NOT EXISTS synthetic_receipts(input_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, turn_id TEXT NOT NULL)');
    l.db.prepare('INSERT INTO synthetic_receipts VALUES(?,?,?)').run(run.input_id,run.task_id,'turn-'+run.id);
    result={committed:true};
  }else result={committed:false};
  // Simulate process termination after durable commit and before scheduler acknowledgement.
}
console.log(JSON.stringify(result));process.exit(0);
