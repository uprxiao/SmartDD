import {test}from'node:test';
import assert from'node:assert/strict';
import{isM13HomePath,isM13PreEntryRun}from'./electron-isolation-paths.mjs';
const executable='/private/tmp/willyou-m13-p1-App004/mac-arm64/WillYou.app/Contents/MacOS/WillYou';
const userData='/private/tmp/willyou-m13-p1-App004-ui-002/userdata',home=userData.replace('/userdata','/home');
test('pre-entry hook requires the matching M13 candidate, fresh run and home',()=>{
 assert.equal(isM13PreEntryRun(executable,userData,home),true);assert.equal(isM13HomePath(home),true);
});
test('daily, mismatched and traversal paths cannot enable a pre-entry hook',()=>{
 for(const candidate of ['/Applications/WillYou.app/Contents/MacOS/WillYou',executable.replace('App004','App003'),executable.replace('/mac-arm64/','/../mac-arm64/')])assert.equal(isM13PreEntryRun(candidate,userData,home),false);
 for(const data of ['/Users/liubu/Library/Application Support/SmartDD',userData.replace('ui-002','ui-003'),userData+'/../userdata'])assert.equal(isM13PreEntryRun(executable,data,home),false);
 for(const value of ['/Users/liubu',home+'/../home',undefined])assert.equal(isM13PreEntryRun(executable,userData,value),false);
});

test('a matching private baseline copy can share the same upgrade home and data',()=>{
 const baseline=executable.replace('/mac-arm64/','/baseline/mac-arm64/');
 assert.equal(isM13PreEntryRun(baseline,userData,home),true);
 for(const candidate of [baseline.replace('App004','App003'),baseline.replace('/baseline/','/unknown/'),baseline.replace('/baseline/','/baseline/../')])assert.equal(isM13PreEntryRun(candidate,userData,home),false);
});
