"""Original D24 external config FI: only exact original row in own project_dirs."""
from pathlib import Path
import json, sqlite3, sys
ROOT=Path('/private/tmp/willyou-m12-t130-D24-App035-A-prep-001')
action, db_name, row_id, project_id, source_path=sys.argv[1:]
allowed=[ROOT/'runtime-001/removed-registration/userdata/smartdd.db',ROOT/'runtime-001/missing-directory/userdata/smartdd.db']
db=Path(db_name).absolute();assert db in allowed and db.is_file();assert Path(source_path)==db.parent.parent/'A'
columns=['id','project_id','label','path','is_default','created_at','updated_at']
def snapshot(c):
 c.row_factory=sqlite3.Row
 row=c.execute('SELECT * FROM project_dirs WHERE id=?',[row_id]).fetchone()
 if row is None:return None
 assert list(row.keys())==columns
 value=dict(row);assert value['id']==row_id and value['project_id']==project_id and value['path']==source_path
 terms=','.join('typeof('+x+'),hex(CAST('+x+' AS BLOB))' for x in columns)
 data=list(c.execute('SELECT '+terms+' FROM project_dirs WHERE id=?',[row_id]).fetchone())
 return {'columns':columns,'row':value,'fieldBytes':{k:{'storageType':data[2*i],'bytesHex':data[2*i+1]} for i,k in enumerate(columns)}}
assert action in ['read','restore']
if action=='read':
 c=sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True);value=snapshot(c);assert value is not None;print(json.dumps(value,ensure_ascii=False,separators=(',',':')));c.close()
else:
 original_text=sys.stdin.read();original=json.loads(original_text);assert original['columns']==columns
 row=original['row'];assert list(row)==columns and row['id']==row_id and row['project_id']==project_id and row['path']==source_path
 c=sqlite3.connect(db);before=snapshot(c);assert before is None,'Never overwrite a current row'
 with c:
  c.execute('INSERT INTO project_dirs ('+','.join(columns)+') VALUES ('+','.join('?' for _ in columns)+')',[row[k] for k in columns])
  after=snapshot(c);assert after==original,'Every original value/storageType/bytes restored exactly'
 print(json.dumps({'before':before,'after':after,'onlyTable':'project_dirs','onlyRowId':row_id,'originalInputText':original_text},ensure_ascii=False,separators=(',',':')));c.close()
