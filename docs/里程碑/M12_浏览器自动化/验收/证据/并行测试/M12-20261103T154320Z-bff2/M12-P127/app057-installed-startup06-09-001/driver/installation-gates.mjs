import assert from 'node:assert/strict';
export function validateInstallationGates(installation,native,pin){
 assert.equal(installation.status,'payload-installed-and-compared-not-startup-accepted');
 assert.equal(installation.inputEqualsDmgEqualsInstalled,true);assert.equal(installation.allOwnedMountsDetached,true);assert.equal(installation.installedApp,pin.app);
 assert.equal(native.actualInstalledApp,pin.app);assert.equal(native.helperMachOArm64,true);assert.equal(native.helperSignatureVerified,true);
 assert.equal(native.helperSha256,pin.packageFiles.find(x=>x.path==='agent-browser/arm64/agent-browser').sha256);
 assert.equal(native.actualSixNativeChecks.version,'0.1.1');assert.equal(native.actualSixNativeChecks.platform,'darwin');assert.equal(native.actualSixNativeChecks.arch,'arm64');
 for(const field of['sqlite','pty','voiceBridge','fileBroker','officeRenderer','fileWatcher'])assert.equal(native.actualSixNativeChecks[field],'passed');
 return{installedApp:pin.app,inputEqualsDmgEqualsInstalled:true,allOwnedMountsDetached:true,actualInstalledSixNativeChecks:native.actualSixNativeChecks};
}
