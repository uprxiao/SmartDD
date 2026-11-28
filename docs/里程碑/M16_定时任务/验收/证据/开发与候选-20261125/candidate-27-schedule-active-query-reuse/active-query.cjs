const {readFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const path=require('node:path');
const root=process.argv[2], mode=process.argv[3], count=Number(process.argv[4]);
if(!['prepare','reuse'].includes(mode)||count<1||count>2000)throw new Error('invalid mode');
const DB=createRequire(path.join(root,'package.json'))('better-sqlite3');
const src=readFileSync(path.join(root,'src/main/core/schedules/store.ts'),'utf8');
const columns=src.match(/^const runColumns='([^']+)';$/m)?.[1], active=src.match(/^const ACTIVE="([^"]+)";$/m)?.[1];
if(!columns||!active)throw new Error('production SQL not matched');
const sql=`SELECT ${columns} FROM schedule_occurrences WHERE status IN (${active})`;
const db=new DB(':memory:');
const ddl=readFileSync(path.join(root,'drizzle/0041_rare_skrulls.sql'),'utf8').split('--> statement-breakpoint').filter(s=>/^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)/i.test(s));
for(const statement of ddl)db.exec(statement);
const startedAt=performance.now();
const cache=mode==='reuse'?db.prepare(sql):null;
let elapsedMs=0;
const observations=[{count:0,...process.memoryUsage()}];
(async()=>{
 for(let i=1;i<=count;i++){
  let t=performance.now(); const rows=(cache||db.prepare(sql)).all(); elapsedMs+=performance.now()-t;
  if(rows.length!==0)throw new Error('expected empty synthetic db');
  if(i%Math.floor(count/4)===0||i===count)observations.push({count:i,...process.memoryUsage()});
  await new Promise(resolve=>setImmediate(resolve));
 }
 db.close();
 console.log(JSON.stringify({mode,count,sql,sqlite:DB.name,elapsedMs,wallMs:performance.now()-startedAt,observations,forcedGC:false}));
})().catch(error=>{console.error(error.message);process.exitCode=1});
