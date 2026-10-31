import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {openManagedDatabase} from './managed-client';
import {acquireDatabaseAccess} from './database-access-gate';
it.skipIf(process.platform!=='darwin')('holds shared ownership for the live client and releases it on close, then reopens retained data',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-managed-db-')));let client:Awaited<ReturnType<typeof openManagedDatabase>>|undefined;
 try{
  client=await openManagedDatabase(join(root,'smartdd.db'));
  client.sqlite.exec("CREATE TABLE retained_business(value TEXT); INSERT INTO retained_business VALUES('retained')");
  await expect(acquireDatabaseAccess(root,'maintenance',{timeoutMs:30})).rejects.toThrow('仍有宿主');
  const second=await openManagedDatabase(join(root,'smartdd.db'));
  try{client.close();client.close();await expect(acquireDatabaseAccess(root,'maintenance',{timeoutMs:30})).rejects.toThrow('仍有宿主');}finally{second.close();}
  const maintenance=await acquireDatabaseAccess(root,'maintenance');maintenance.release();
  client=await openManagedDatabase(join(root,'smartdd.db'));
  expect(client.sqlite.prepare('SELECT * FROM retained_business').all()).toEqual([{value:'retained'}]);
 }finally{client?.close();rmSync(root,{recursive:true,force:true});}
},20000);

it.skipIf(process.platform!=='darwin')('does not treat a completed file mirror as authority when its DB receipt is missing',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-managed-receipt-')));let client:Awaited<ReturnType<typeof openManagedDatabase>>|undefined;
 try{
  client=await openManagedDatabase(join(root,'smartdd.db'));
  client.sqlite.exec("DELETE FROM capability_resource_operations WHERE kind='database-migration'");client.close();
  await expect(openManagedDatabase(join(root,'smartdd.db'))).rejects.toThrow('没有可核验');
  const maintenance=await acquireDatabaseAccess(root,'maintenance');maintenance.release();
 }finally{client?.close();rmSync(root,{recursive:true,force:true});}
},20000);
