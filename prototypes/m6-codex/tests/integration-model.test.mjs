import test from 'node:test';
import assert from 'node:assert/strict';
import { initialIntegrationState, projectIntegrationState, validateConnection, availableConnections, saveConnection, referenceText, packageVersion, projectPackages, toggleProjectApplication, integrationSnapshot, snapshotCurrent, simulatePackageUpgrade, selectedConnections, switchProjectZenTao, sessionApplicationState, projectAppEnabled, removeApplication, validMailDays, saveDemoDraft, packageRetention, connectionIdentityChanged, mailQueryWindow, verifyDemoSendAccepted } from '../src/integration-model.mjs';
import { selectProjectMailConnection, sessionCapabilityDiagnostic, recoverSessionCapability, demoDraftSendEligibility, mailSourceDiagnostic } from '../src/integration-model.mjs';

test('projection drops passwords, tokens, unknown apps and dangling project bindings', () => {
  const source = initialIntegrationState();
  source.connections[0].password = 'sensitive-marker'; source.connections[0].token = 'sensitive-marker';
  source.connections.push({ id: 'unknown', app: 'arbitrary-code', password: 'sensitive-marker' });
  source.installed.push('arbitrary-code'); source.bindings.ais.push('missing', 'unknown');
  const result = projectIntegrationState(source);
  assert.ok(!JSON.stringify(result).includes('sensitive-marker'));
  assert.equal(result.connections.length, 2); assert.deepEqual(result.bindings.ais, ['zt-demo', 'fox-demo']);
});
test('availability checks current project binding, connection health and application installation', () => {
  const source = initialIntegrationState();
  assert.equal(availableConnections(source, 'ais').length, 2); assert.equal(availableConnections(source, 'smartdd').length, 1);
  source.connections[0].enabled = false; assert.equal(availableConnections(source, 'smartdd').length, 0);
  source.connections[1].validation = 'disconnected'; assert.equal(availableConnections(source, 'ais').length, 0);
});
test('editing a paused connection keeps it paused and stores a credential-presence flag only', () => {
  const source = initialIntegrationState(); source.connections[0].enabled = false;
  const next = saveConnection(source, { ...source.connections[0], name: 'changed', password: 'must-not-store' }, true);
  assert.equal(next.connections[0].enabled, false); assert.equal(next.connections[0].revision, 2);
  assert.equal(next.connections[0].credentialPresent, true); assert.ok(!JSON.stringify(next).includes('must-not-store'));
});
test('ZenTao config rejects embedded secrets, query strings and non-HTTP addresses', () => {
  const base = { ...initialIntegrationState().connections[0] };
  for (const url of ['file:///etc/passwd', 'https://user:secret@host/biz', 'https://host/biz?token=value', 'not-a-url']) assert.ok(validateConnection({ ...base, url }));
  assert.equal(validateConnection(base), '');
});
test('local mailbox needs an absolute source and never needs a password', () => {
  const base = initialIntegrationState().connections[1];
  assert.equal(validateConnection(base), ''); assert.ok(validateConnection({ ...base, path: 'relative/path' }));
  assert.ok(validateConnection({ ...base, path: '/tmp/a\nother' }));
});
test('sender validates account, service and integer port separately from local reading', () => {
  const base = { name: 'sender', kind: 'smtp', host: 'smtp.example.invalid', port: 465, account: 'demo@example.invalid' };
  assert.equal(validateConnection(base, 'synthetic'), ''); assert.ok(validateConnection(base));
  for (const port of [0, 65536, 1.1, 'bad']) assert.ok(validateConnection({ ...base, port }, 'synthetic'));
  assert.ok(validateConnection({ ...base, host: 'a/b' }, 'synthetic'));
});
test('object references preserve Bug/Story namespace and contain no executable control characters', () => {
  const bug = referenceText('bug', 812), story = referenceText('story', 812);
  assert.notEqual(bug, story); assert.match(bug, /\/bug\/812/); assert.match(story, /\/story\/812/);
  assert.ok(!/[\x00-\x1f\x7f]/.test(referenceText('mail', 'm-101')));
  assert.match(referenceText('story', 146, 'new-connection'), /zentao:\/\/new-connection\/story\/146/);
});
test('new prototype projects keep bindings through persistence projection', () => {
  const source = initialIntegrationState(); source.bindings['preview-new-project'] = ['zt-demo'];
  const result = projectIntegrationState(source);
  assert.equal(availableConnections(result, 'preview-new-project').length, 1);
});

test('old saved configurations gain package metadata without replacing connections or project bindings', () => {
  const source = initialIntegrationState(), saved = JSON.parse(JSON.stringify(source));
  const restored = projectIntegrationState(saved);
  assert.equal(packageVersion(restored, 'zentao'), '1.0.0');
  assert.equal(restored.dataSchema, 1);
  assert.deepEqual(restored.connections, saved.connections);
  assert.deepEqual(restored.bindings, saved.bindings);
});

test('project application enablement bundles skills once and never enables pending external writes', () => {
  const source = initialIntegrationState();
  source.connections.push({ ...source.connections[0], id: 'second-zen' });
  source.bindings.ais.push('second-zen');
  const bundles = projectPackages(source, 'ais');
  assert.equal(bundles.filter(p => p.id === 'zentao').length, 1);
  assert.equal(bundles[0].skills.length, 2);
  assert.equal(bundles[0].connections.length, 0); // ambiguous legacy selection cannot silently choose an account
  assert.ok(!bundles[0].tools.includes('object.transition'));
  assert.deepEqual(bundles.find(p => p.id === 'mail').tools, ['mail.search', 'mail.read', 'mail.draft', 'mail.send']);
});

test('application disablement preserves selection and other projects; enabling never selects a fallback', () => {
  const source = initialIntegrationState();
  source.connections.push({ ...source.connections[0], id: 'paused-zen', enabled: false }, { ...source.connections[0], id: 'other-account' });
  const disabled = toggleProjectApplication(source, 'ais', 'zentao', false);
  assert.deepEqual(disabled.bindings.ais, source.bindings.ais);
  assert.deepEqual(disabled.bindings.smartdd, ['zt-demo']);
  assert.deepEqual(disabled.connections, source.connections);
  assert.equal(projectPackages(disabled, 'ais').some(p => p.id === 'zentao'), false);
  const enabled = toggleProjectApplication(disabled, 'ais', 'zentao', true);
  assert.ok(enabled.bindings.ais.includes('zt-demo'));
  assert.ok(!enabled.bindings.ais.includes('paused-zen'));
  assert.ok(!enabled.bindings.ais.includes('other-account'));
  const uninstalled = { ...disabled, installed: ['mail'] };
  assert.equal(projectAppEnabled(toggleProjectApplication(uninstalled, 'ais', 'zentao', true), 'ais', 'zentao'), false);
});

test('fixed session identity survives edits, upgrades and revocation but cannot cross projects', () => {
  const source = projectIntegrationState(initialIntegrationState());
  const snapshot = integrationSnapshot(source, 'ais');
  assert.ok(snapshotCurrent(snapshot, source, 'ais'));
  assert.equal(snapshotCurrent(snapshot, source, 'smartdd'), false);
  const edited = { ...source, connections: source.connections.map(c => ({ ...c, revision: c.revision + 1 })) };
  assert.equal(snapshotCurrent(snapshot, edited, 'ais'), true);
  assert.equal(snapshotCurrent(snapshot, simulatePackageUpgrade(source).state, 'ais'), true);
  assert.equal(snapshot.packages[0].version, '1.0.0');
  assert.equal(integrationSnapshot(simulatePackageUpgrade(source).state, 'ais').packages[0].version, '1.1.0');
  assert.equal(snapshotCurrent(snapshot, toggleProjectApplication(source, 'ais', 'mail', false), 'ais'), true);
  assert.equal(sessionApplicationState(snapshot, toggleProjectApplication(source, 'ais', 'mail', false), 'ais', 'mail').usable, false);
});

test('simulated upgrade preserves all local records; a failed migration leaves the original state untouched', () => {
  const source = projectIntegrationState(initialIntegrationState());
  source.activity.push({ id: 'existing-invocation', app: 'zentao', operation: '读取', status: 'success', project: 'ais', connectionId: 'zt-demo', at: '10:30' });
  const before = JSON.stringify(source), failed = simulatePackageUpgrade(source, true);
  assert.equal(failed.ok, false); assert.equal(failed.state, source);
  assert.equal(JSON.stringify(source), before);
  const upgrade = simulatePackageUpgrade(source);
  assert.equal(upgrade.ok, true); assert.equal(upgrade.state.dataSchema, 2);
  assert.equal(packageVersion(upgrade.state, 'zentao'), '1.1.0');
  for (const key of ['connections', 'bindings', 'activity', 'installed']) assert.deepEqual(upgrade.state[key], source[key]);
  assert.equal(JSON.stringify(source), before);
  assert.equal(packageVersion(projectIntegrationState(upgrade.state), 'mail'), '1.1.0');
});


test('unhealthy connections do not remove capabilities from a new snapshot', () => {
 const source = projectIntegrationState(initialIntegrationState());
 const expected = integrationSnapshot(source, 'ais');
 source.connections.forEach(c => { c.enabled = false; c.validation = 'expired'; });
 assert.deepEqual(integrationSnapshot(source, 'ais'), expected);
 assert.equal(sessionApplicationState(expected, source, 'ais', 'zentao').usable, false);
 assert.equal(sessionApplicationState(expected, source, 'ais', 'mail').usable, true);
});
test('mail can be enabled without any connection and draft ability does not imply SMTP availability', () => {
 const source = projectIntegrationState({ installed: ['mail'], connections: [], bindings: { p: [] } });
 const enabled = toggleProjectApplication(source, 'p', 'mail', true);
 assert.deepEqual(enabled.bindings.p, []);
 assert.ok(projectPackages(enabled, 'p')[0].tools.includes('mail.draft'));
 assert.equal(availableConnections(enabled, 'p').length, 0);
 assert.match(sessionApplicationState(integrationSnapshot(enabled, 'p'), enabled, 'p', 'mail').label, /尚无可用SMTP/);
});
test('ZenTao switching is rejected until all related runs stop and leaves other projects unchanged', () => {
 const source = projectIntegrationState(initialIntegrationState());
 source.connections.push({ ...source.connections[0], id:'zt-second', account:'other' });
 const snapshot = integrationSnapshot(source, 'ais');
 const runs = [{ id:'t', project:'ais', status:'running', integrationSnapshot:snapshot }];
 const denied = switchProjectZenTao(source, 'ais', 'zt-second', runs);
 assert.equal(denied.ok, false); assert.equal(denied.state, source);
 const switched = switchProjectZenTao(source, 'ais', 'zt-second', runs.map(t => ({ ...t, status:'stopped' })));
 assert.ok(switched.ok); assert.equal(selectedConnections(switched.state,'ais','zentao')[0].id,'zt-second');
 assert.deepEqual(switched.state.bindings.smartdd,source.bindings.smartdd);
 assert.equal(snapshot.packages[0].connections[0].id,'zt-demo');
 assert.equal(snapshot.packages[0].version,'1.0.0');
 assert.equal(sessionApplicationState(snapshot,switched.state,'ais','zentao').connections[0].id,'zt-second');
});
test('removal preserves credentials, history, drafts and references; adding again does not re-enable projects', () => {
 const source = projectIntegrationState(initialIntegrationState());
 const saved = saveDemoDraft(source,'ais').state;
 const removed = removeApplication(saved,'mail');
 for (const key of ['connections','drafts','activity','bindings']) assert.deepEqual(removed[key],saved[key]);
 assert.equal(projectAppEnabled({...removed,installed:[...removed.installed,'mail']},'ais','mail'),false);
});
test('mail query days enforce integers 1–100 and migration preserves an existing valid 7', () => {
 for (const n of [1,7,30,100,'30']) assert.ok(validMailDays(n));
 for (const n of [0,-1,101,3.5,'','3 days',null]) assert.equal(validMailDays(n),false);
 assert.equal(projectIntegrationState(initialIntegrationState()).mailQueryDays,30);
 assert.equal(projectIntegrationState({...initialIntegrationState(),mailQueryDays:7}).mailQueryDays,7);
});
test('synthetic draft roundtrip keeps identity and revision, drops arbitrary body and detects concurrent edits', () => {
 const source = projectIntegrationState(initialIntegrationState());
 const created = saveDemoDraft(source,'ais');
 const edited = saveDemoDraft(created.state,'ais',created.draft.id,1);
 const conflicted = saveDemoDraft(edited.state,'ais',created.draft.id,1);
 assert.ok(created.ok); assert.ok(edited.ok); assert.equal(conflicted.ok,false);
 edited.state.drafts[0].body='never-persist-real-mail';
 const restored = projectIntegrationState(edited.state);
 assert.equal(restored.drafts[0].id,created.draft.id); assert.equal(restored.drafts[0].revision,2);
 assert.ok(!JSON.stringify(restored).includes('never-persist-real-mail'));
 restored.drafts[0].status='unknown';
 assert.equal(saveDemoDraft(restored,'ais',created.draft.id,2).ok,false);
});
test('stopped and archived sessions protect old versions; unknown historical capability is conservative', () => {
 const old = projectIntegrationState(initialIntegrationState()), snapshot=integrationSnapshot(old,'ais'), upgraded=simulatePackageUpgrade(old).state;
 const usage=packageRetention(upgraded,[{id:'old',status:'stopped',archived:true,integrationSnapshot:snapshot}],'mail','1.0.0');
 assert.equal(usage.references.length,1); assert.equal(usage.running,0); assert.equal(usage.cleanable,false);
 assert.equal(packageRetention(upgraded,[],'mail','1.0.0').cleanable,true);
 assert.equal(packageRetention(upgraded,[{id:'unknown'}],'mail','1.0.0').cleanable,false);
 assert.equal(packageRetention(upgraded,[],'mail','1.1.0').cleanable,false);
});


test('shared-discovery runs postpone upgrade publication without stopping the Agent or changing defaults', () => {
 const source=projectIntegrationState(initialIntegrationState());
 const result=simulatePackageUpgrade(source,false,[{id:'c',runner:'codex',status:'running'}]);
 assert.equal(result.waiting,true); assert.equal(result.state,source); assert.equal(result.ok,false);
 assert.equal(simulatePackageUpgrade(source,false,[{id:'c',runner:'codex',status:'stopped'}]).ok,true);
 assert.equal(simulatePackageUpgrade(source,false,[{id:'c',runner:'claude',status:'running',sharedSkillDiscovery:true}]).waiting,true);
});
test('editing an existing account identity is rejected; ordinary same-identity credential rotation remains allowed', () => {
 const source=projectIntegrationState(initialIntegrationState()), original=source.connections[0];
 for(const draft of [{...original,account:'other'}, {...original,url:'https://other.invalid/'}]) { assert.equal(connectionIdentityChanged(original,draft),true);assert.equal(saveConnection(source,draft,true),source); }
 const rotated=saveConnection(source,{...original,name:'Same identity'},true);
 assert.equal(rotated.connections[0].revision,2);assert.equal(rotated.connections[0].account,original.account);
 const local=source.connections[1];
 assert.equal(saveConnection(source,{...local,path:'/Users/demo/other-source'},false),source);
 assert.equal(saveConnection(source,{...local,name:'Same local source'},false).connections[1].path,local.path);
});
test('natural-day query windows include today and pin a concrete range', () => {
 const now=new Date(2026,9,19,15,0,0), window=mailQueryWindow(30,now);
 assert.equal(window.from,'2026-09-20');assert.equal(window.through,'2026-10-19');assert.equal(window.days,30);assert.ok(window.timezone);
 assert.equal(mailQueryWindow(1,now).from,'2026-10-19');
});


test('verifying an unknown send synchronizes only the exact related draft revision without a second send', () => {
 const source=projectIntegrationState(initialIntegrationState());
 source.drafts=[{id:'draft-a',project:'ais',revision:2,status:'unknown'}, {id:'draft-b',project:'ais',revision:2,status:'unknown'}];
 source.activity=[{id:'send-a-r2',app:'mail',operation:'发送示例草稿 r2',status:'unknown',project:'ais',draftId:'draft-a',revision:2}];
 const accepted=verifyDemoSendAccepted(source,'send-a-r2');
 assert.equal(accepted.activity.length,1);assert.equal(accepted.activity[0].id,'send-a-r2');assert.equal(accepted.activity[0].status,'success');
 assert.equal(accepted.drafts[0].status,'success');assert.equal(accepted.drafts[1],source.drafts[1]);
 assert.equal(source.activity[0].status,'unknown');assert.equal(source.drafts[0].status,'unknown');
 assert.equal(verifyDemoSendAccepted(accepted,'send-a-r2'),accepted);
 const changed={...source,drafts:[{...source.drafts[0],revision:3}, source.drafts[1]]};
 const checked=verifyDemoSendAccepted(changed,'send-a-r2');
 assert.equal(checked.activity[0].status,'success');assert.equal(checked.drafts[0],changed.drafts[0]);assert.equal(checked.drafts[1],changed.drafts[1]);
 const otherProject={...source,drafts:[{...source.drafts[0],project:'other'}]};
 assert.equal(verifyDemoSendAccepted(otherProject,'send-a-r2').drafts[0],otherProject.drafts[0]);
});

test('mail has independent nullable source and sender selections; legacy ambiguous groups fail closed', () => {
 const source=projectIntegrationState(initialIntegrationState());
 source.connections.push({...source.connections[1],id:'fox-two'}, {id:'smtp-one',app:'mail',kind:'smtp',enabled:true,validation:'ready'}, {id:'smtp-two',app:'mail',kind:'smtp',enabled:true,validation:'ready'});
 source.bindings.ais.push('fox-two','smtp-one','smtp-two');
 assert.deepEqual(selectedConnections(source,'ais','mail'),[]);
 const read=selectProjectMailConnection(source,'ais','local','fox-two');
 assert.deepEqual(selectedConnections(read,'ais','mail').map(c=>c.id),['fox-two']);
 const both=selectProjectMailConnection(read,'ais','smtp','smtp-two');
 assert.deepEqual(selectedConnections(both,'ais','mail').map(c=>c.id),['fox-two','smtp-two']);
 const noSend=selectProjectMailConnection(both,'ais','smtp','');
 assert.deepEqual(selectedConnections(noSend,'ais','mail').map(c=>c.id),['fox-two']);
 assert.deepEqual(noSend.bindings.smartdd,source.bindings.smartdd);
 assert.equal(selectProjectMailConnection(noSend,'ais','local','smtp-one'),noSend);
 assert.equal(selectProjectMailConnection(noSend,'ais','local','fox-two'),noSend);
 assert.equal(projectIntegrationState(noSend).mailBindingRevisions.ais,3);
 assert.ok(saveDemoDraft(noSend,'ais').ok);
});

test('clearing the last mail connection preserves independent enablement and draft capability across reload', () => {
 for(const source of [initialIntegrationState(),projectIntegrationState(initialIntegrationState())]) {
  const cleared=selectProjectMailConnection(source,'ais','local','');
  assert.equal(projectAppEnabled(cleared,'ais','mail'),true);
  assert.equal(selectedConnections(cleared,'ais','mail').length,0);
  const restored=projectIntegrationState(cleared);
  assert.equal(projectAppEnabled(restored,'ais','mail'),true);
  assert.ok(projectPackages(restored,'ais').find(p=>p.id==='mail').tools.includes('mail.draft'));
  assert.equal(sessionApplicationState(integrationSnapshot(restored,'ais'),restored,'ais','mail').usable,true);
  assert.equal(saveDemoDraft(restored,'ais').ok,true);
  const disabled=toggleProjectApplication(source,'ais','mail',false);
  assert.equal(projectAppEnabled(selectProjectMailConnection(disabled,'ais','local',''),'ais','mail'),false);
 }
});

test('changing project mail sender invalidates old draft intent and requires explicit new revision', () => {
 let source=projectIntegrationState(initialIntegrationState());
 source.connections.push({id:'smtp-a',app:'mail',kind:'smtp',enabled:true,validation:'ready'}, {id:'smtp-b',app:'mail',kind:'smtp',enabled:true,validation:'ready'});
 source=selectProjectMailConnection(source,'ais','smtp','smtp-a');
 const created=saveDemoDraft(source,'ais');
 assert.equal(saveDemoDraft(created.state,'smartdd',created.draft.id,created.draft.revision).ok,false);
 assert.equal(demoDraftSendEligibility(created.state,'ais',created.draft).ok,true);
 const switched=selectProjectMailConnection(created.state,'ais','smtp','smtp-b');
 assert.equal(demoDraftSendEligibility(switched,'ais',created.draft).changed,true);
 assert.equal(switched.drafts[0].senderId,'smtp-a');
 const updated=saveDemoDraft(switched,'ais',created.draft.id,created.draft.revision);
 assert.equal(updated.draft.senderId,'smtp-b');assert.equal(updated.draft.revision,2);
 assert.equal(demoDraftSendEligibility(updated.state,'ais',updated.draft).ok,true);
 const removed=selectProjectMailConnection(updated.state,'ais','smtp','');
 assert.equal(demoDraftSendEligibility(removed,'ais',updated.draft).ok,false);
 const paused={...updated.state,connections:updated.state.connections.map(c=>c.id==='smtp-b'?{...c,enabled:false}:c)};
 assert.equal(demoDraftSendEligibility(paused,'ais',updated.draft).ok,false);
 assert.equal(demoDraftSendEligibility(updated.state,'smartdd',updated.draft).ok,false);
});

test('fixed-package fault repairs preserve session identity, default version, business data and failure state', () => {
 const before=projectIntegrationState(initialIntegrationState()), snapshot=integrationSnapshot(before,'ais');
 const source=saveDemoDraft(simulatePackageUpgrade(before).state,'ais').state, fixed=JSON.stringify(snapshot);
 for(const fault of ['missing','corrupt','incompatible','bridge']) {
   assert.equal(sessionCapabilityDiagnostic(snapshot,source,'ais','mail',fault).usable,false);
   const fail=recoverSessionCapability(snapshot,source,'ais','mail',fault,false);
   assert.equal(fail.ok,false);assert.equal(fail.state,source);assert.equal(fail.fault,fault);
   const success=recoverSessionCapability(snapshot,source,'ais','mail',fault,true);
   assert.equal(success.ok,true);assert.equal(success.fault,'none');assert.equal(success.state.packages.mail,'1.1.0');
   assert.deepEqual(success.state.drafts,source.drafts);assert.deepEqual(success.state.connections,source.connections);
   assert.equal(JSON.stringify(snapshot),fixed);assert.match(success.message,/v1.0.0/);
 }
 const missing={...source,installedVersions:{...source.installedVersions,mail:['1.1.0']}};
 const repaired=recoverSessionCapability(snapshot,missing,'ais','mail','none',true);
 assert.equal(repaired.state.installedVersions.mail.includes('1.0.0'),true);assert.equal(repaired.state.packages.mail,'1.1.0');
});

test('bridge that requires next launch cannot be reconnected in place or bypass current revocation', () => {
 const source=projectIntegrationState(initialIntegrationState()), snapshot=integrationSnapshot(source,'ais');
 const diagnostic=sessionCapabilityDiagnostic(snapshot,source,'ais','mail','bridgeRestart');
 assert.equal(diagnostic.code,'BRIDGE_RESTART_REQUIRED');assert.equal(diagnostic.action,undefined);
 assert.equal(recoverSessionCapability(snapshot,source,'ais','mail','bridgeRestart',true).ok,false);
 const revoked=toggleProjectApplication(source,'ais','mail',false);
 const result=recoverSessionCapability(snapshot,revoked,'ais','mail','bridge',true);
 assert.equal(result.ok,false);assert.equal(result.state,revoked);
 assert.equal(sessionCapabilityDiagnostic(null,source,'ais','mail','missing').action,undefined);
});

test('capability name conflicts require explicit resolved evidence and never overwrite or rename user capabilities', () => {
 const source={...projectIntegrationState(initialIntegrationState()),userCapabilities:{pluginNamespace:'willyou-mail',skillName:'willyou-mail:mail-work-assistant',mcpKey:'willyou-mail'}};
 const snapshot=integrationSnapshot(source,'ais'), original=JSON.stringify(source), fixed=JSON.stringify(snapshot);
 const conflict=sessionCapabilityDiagnostic(snapshot,source,'ais','mail','nameConflict');
 assert.equal(conflict.code,'AGENT_CAPABILITY_NAME_CONFLICT');assert.equal(conflict.usable,false);
 assert.equal(sessionCapabilityDiagnostic(snapshot,source,'ais','mail','incompatible').code,'CONFIG_INCOMPATIBLE');
 for(const result of [recoverSessionCapability(snapshot,source,'ais','mail','nameConflict'),recoverSessionCapability(snapshot,source,'ais','mail','nameConflict',false,{userResolvedConflict:true})]) {
  assert.equal(result.ok,false);assert.equal(result.fault,'nameConflict');assert.equal(result.state,source);
 }
 const rechecked=recoverSessionCapability(snapshot,source,'ais','mail','nameConflict',true,{userResolvedConflict:true});
 assert.equal(rechecked.ok,true);assert.equal(rechecked.state,source);assert.equal(rechecked.fault,'none');
 assert.equal(JSON.stringify(source),original);assert.equal(JSON.stringify(snapshot),fixed);
 const revoked=toggleProjectApplication(source,'ais','mail',false);
 assert.equal(recoverSessionCapability(snapshot,revoked,'ais','mail','nameConflict',true,{userResolvedConflict:true}).ok,false);
});

test('Foxmail partial, unsupported and failed reads never masquerade as a complete empty search', () => {
 for(const scene of ['denied','locked','unsupported','error']) {
  assert.equal(mailSourceDiagnostic(scene,true).state,'failed');
 }
 assert.equal(mailSourceDiagnostic('partial',true).state,'partial');
 assert.equal(mailSourceDiagnostic('empty',true).state,'complete');
 assert.equal(mailSourceDiagnostic('empty',false).state,'unselected');
 assert.equal(mailSourceDiagnostic('empty',false,true).state,'failed');
 assert.equal(mailSourceDiagnostic('ready',false,false).title,'未选用读取来源');
 assert.match(mailSourceDiagnostic('unsupported',true).reason,/不提供导出后导入/);
});
