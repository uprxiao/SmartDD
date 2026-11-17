// Run with ELECTRON_RUN_AS_NODE=1 and the Electron-ABI module as argv[2].
const Database=require(process.argv[2]);const db=new Database(':memory:');
const row=db.prepare('SELECT 7 AS value').get();db.close();
if(row.value!==7)throw Error('SQLite ABI smoke failed');
console.log(JSON.stringify({scope:'Electron as Node + SQLite ABI only; no browser UI',electron:process.versions.electron,modulesAbi:process.versions.modules,value:row.value}));
