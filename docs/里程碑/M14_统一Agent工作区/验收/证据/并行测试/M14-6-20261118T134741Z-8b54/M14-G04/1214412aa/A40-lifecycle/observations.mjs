import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,realpathSync,statSync} from 'node:fs';

export const homePermissionCheck="document.querySelector('[data-testid=home-permission]')?.getAttribute('aria-label') === '权限：完全访问权限'";

const reader=`from pathlib import Path
import sqlite3,sys,json
path=Path(sys.argv[1])
query="?mode=ro"
if sys.argv[4]=="closed" and (not Path(str(path)+"-wal").exists() or Path(str(path)+"-wal").stat().st_size==0):
    query+="&immutable=1"
c=sqlite3.connect(path.as_uri()+query,uri=True,timeout=1)
c.row_factory=sqlite3.Row
c.execute("PRAGMA query_only=ON")
c.execute("BEGIN")
result={name:[dict(x) for x in c.execute(sql,[sys.argv[2]])] for name,sql in json.loads(sys.argv[3]).items()}
c.rollback()
c.close()
print(json.dumps(result))
`;

export function readExactA40Database(db,key,queries,phase='active'){
  assert(['active','closed'].includes(phase));
  assert.match(db,/^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}\/runtime-[A-Za-z0-9]+\/data\/smartdd\.db$/);
  assert.equal(realpathSync(db),db);
  assert(statSync(db).isFile());
  for(const sidecar of [db+'-wal',db+'-shm']){
    if(existsSync(sidecar))assert.equal(realpathSync(sidecar),sidecar);
  }
  return JSON.parse(execFileSync('/usr/bin/python3',['-c',reader,db,key,JSON.stringify(queries),phase],
    {encoding:'utf8',timeout:4000,maxBuffer:2*1024*1024}));
}
