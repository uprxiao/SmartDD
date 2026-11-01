const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const out = '/private/tmp/willyou-m11-s10-fixtures/preparation-001';
const source = '/private/tmp/willyou-m11-s4/source-attempt-003';
const ts = require(path.join(source, 'node_modules/typescript'));
const provenance = JSON.parse(fs.readFileSync(path.join(out, 'provenance.json'), 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function load(name) {
  const code = fs.readFileSync(path.join(source, 'src/main/core/applications', name), 'utf8');
  const js = ts.transpileModule(code, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports:{}};
  // Execute trusted frozen parser code only. Native log content is parsed as data.
  new Function('require','module','exports',js)(require,module,module.exports);
  return module.exports;
}
const {codexSkillDiscoveryEvidence} = load('codex-skill-discovery-evidence.ts');
const {codexSkillReadEvidence} = load('codex-skill-read-evidence.ts');
const lines = fs.readFileSync(provenance.originalLog,'utf8').trimEnd().split('\n');
const derived = fs.readFileSync(path.join(out,'codex-0166-derived-minimal.jsonl'),'utf8').trimEnd().split('\n');
const rows = lines.map(line=>JSON.parse(line));
const times = rows.map(row=>Date.parse(row.timestamp)).filter(Number.isFinite);
const from=Math.min(...times)-1,to=Math.max(...times)+1;
const originalDiscovery=codexSkillDiscoveryEvidence(lines,[provenance.originalTarget],from,to);
const derivedDiscovery=codexSkillDiscoveryEvidence(derived,[provenance.fixtureTarget],from,to);
const originalReads=codexSkillReadEvidence(lines,[provenance.originalTarget],from,to);
const userRows=rows.filter(row=>row.type==='response_item'&&row.payload?.type==='message'&&row.payload?.role==='user');
const userShape=userRows.every(row=>Number.isFinite(Date.parse(row.timestamp))&&Array.isArray(row.payload.content)&&row.payload.content.length>0&&row.payload.content.every(p=>p?.type==='input_text'&&typeof p.text==='string'));
const native=fs.readFileSync(path.join(source,'src/main/core/applications/native-user-messages.ts'),'utf8');
const result={
 schema:'willyou-native-format-preparation-v1',status:'prepared-derived-fixture',cliVersion:'0.166.0',
 provenance:'provenance.json',fixture:'codex-0166-derived-minimal.jsonl',fixtureIsOriginal:false,
 originalSkillCatalogObservations:originalDiscovery,derivedSkillCatalogObservations:derivedDiscovery,
 originalSkillReadObservations:originalReads,skillReadObserved:originalReads.length>0,positiveSkillReadFixtureCreated:false,
 actualUserRecordCount:userRows.length,allUserRowsMeetLegacyMessageFieldGrammar:userShape,
 headerHasLegacyIdAndCwd:typeof rows[0].payload.id==='string'&&typeof rows[0].payload.cwd==='string',
 oldClassExplicitlySupports162Only:/codex:\s*\['0\.162\.1'\]/.test(native),
 differenceConclusion:'The frozen 0.162.1 pure discovery parser accepts the observed 0.166.0 developer catalog, and user record fields satisfy the old structural grammar. The NativeUserMessages version gate explicitly excludes 0.166.0. No definite incompatible record-schema difference is established by this trace.',
 absentEvidence:'There is no exec_command/custom exec Skill-read call or matching read output in the original trace. The only tool call is smartdd_mail_draft_list_v2. No 0.162.1 raw trace was inspected, so this is parser-contract comparison, not a side-by-side version log comparison.',
 securityBoundary:'Pure trusted parser functions only; full owned-run identity, accepted-PTY input receipts, before/after projection validation, and NativeUserMessages integration were not exercised. No L1/L2/L3 acceptance claim.',
 sourceLogUnchanged:sha(fs.readFileSync(provenance.originalLog))===provenance.originalLogSha256,
 formalCasePassesAdded:0,sharedResourceLeaseUsed:false,
};
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
fs.writeFileSync(path.join(out,'cleanup.json'),JSON.stringify({at:new Date().toISOString(),preparationOnly:true,agentsOrModelsStarted:false,listenersStarted:false,sharedOutOrDependenciesWritten:false,sourceOrPublicLedgerWritten:false,dailyCodexOrAuthRead:false,originalLogUnchanged:result.sourceLogUnchanged,resourceLease:'none used; no retained processes'},null,2)+'\n');
const files=fs.readdirSync(out).filter(name=>name!=='manifest.json'&&fs.statSync(path.join(out,name)).isFile()).sort().map(name=>({path:name,bytes:fs.statSync(path.join(out,name)).size,sha256:sha(fs.readFileSync(path.join(out,name)))}));
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({schema:'willyou-evidence-manifest-v1',batch:'M11-S10-native-format-preparation',attempt:1,files},null,2)+'\n');
process.stdout.write(JSON.stringify({originalDiscovery:originalDiscovery.length,derivedDiscovery:derivedDiscovery.length,skillReads:originalReads.length,userRecordCount:userRows.length,legacyUserGrammar:userShape,sourceLogUnchanged:result.sourceLogUnchanged,manifestSha256:sha(fs.readFileSync(path.join(out,'manifest.json')))}));
