import {readFileSync,writeFileSync} from 'node:fs';
import {normalizer} from '/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M14_统一Agent工作区/技研/实验/20261116_复核修订验证/timeline.mjs';
const root='/Users/liubu/hx/4.uprxiao/SmartDD/docs/里程碑/M14_统一Agent工作区/技研/复核_20261116/probes/evidence';
const out=process.env.M14_REVIEW_OUT;
const uses=JSON.parse(readFileSync(root+'/v10/claude-todo-uses.json','utf8'));
const n=normalizer('v10-review'), items=new Map();
for(const [i,use] of uses.entries()){
 // Only the tool_use blocks are archived. Envelopes here are explicitly synthetic.
 for(const item of n({driver:'claude',type:'assistant',uuid:'synthetic-envelope-'+i,message:{content:[use]}}))if(item.kind==='item')items.set(item.id,item);
}
const goalNative=readFileSync(root+'/v14/native.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(e=>e.method?.startsWith('thread/goal/'));
const ng=normalizer('goal-review'), goal=goalNative.map(e=>({sourceMethod:e.method,sourceStatus:e.params?.goal?.status,output:ng(e)}));
const result={todo:{scope:'real extracted V10 tool_use blocks inside synthetic SDK envelopes; no new model call',nativeUses:uses.length,taskCreates:uses.filter(u=>u.name==='TaskCreate').length,taskUpdates:uses.filter(u=>u.name==='TaskUpdate').length,visibleTodoItemCount:[...items.values()].filter(i=>i.type==='todo_list').length,itemIds:[...items.keys()]},goal:{scope:'unaltered archived Codex V14 goal notifications',events:goal.length,unmapped:goal.filter(g=>g.output.some(o=>o.kind==='unmapped')).length,methods:[...new Set(goal.map(g=>g.sourceMethod))],sample:goal.slice(0,2)}};
writeFileSync(out+'/new-recordings-replay.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
