import {describe,it,expect} from 'vitest';
import {agentAdapterMetadataSchema} from '@shared/agent-adapters';
const original={schema:'willyou-agent-adapter-v1',agentId:'codex',version:'1.0.0',entry:'index.cjs',projectionFormatVersion:1,platforms:['darwin-arm64'],cliVersions:['0.162.1'],bridgeRecovery:'unverified',evidenceBaseline:'original immutable manifest'};
const supported={...original,bridgeRecovery:'supported',configReload:'supported',recoveryRequiresAgentRestart:false,recoveryEntry:'replaceBridge',recoveryEvidence:[{cliVersion:'0.162.1',baseline:'controlled test evidence'}]};
describe('independent recovery capability contract',()=>{
 it('preserves old unverified metadata without inserting fields into its content identity',()=>{expect(agentAdapterMetadataSchema.parse(original)).toEqual(original);});
 it.each(['configReload','recoveryRequiresAgentRestart','recoveryEntry','recoveryEvidence'])('rejects a supported claim without %s',key=>{const value={...supported} as Record<string,unknown>;delete value[key];expect(agentAdapterMetadataSchema.safeParse(value).success).toBe(false);});
 it('rejects restart-required and wrong-version evidence',()=>{
  expect(agentAdapterMetadataSchema.safeParse({...supported,recoveryRequiresAgentRestart:true}).success).toBe(false);
  expect(agentAdapterMetadataSchema.safeParse({...supported,recoveryEvidence:[{cliVersion:'0.163.0',baseline:'other version'}]}).success).toBe(false);
 });
 it('requires evidence for every declared CLI version and rejects duplicates',()=>{
  expect(agentAdapterMetadataSchema.safeParse({...supported,cliVersions:['0.162.1','0.163.0']}).success).toBe(false);
  expect(agentAdapterMetadataSchema.safeParse({...supported,recoveryEvidence:[...supported.recoveryEvidence,...supported.recoveryEvidence]}).success).toBe(false);
 });
 it('accepts a complete capability declaration without treating it as execution evidence',()=>{expect(agentAdapterMetadataSchema.parse(supported)).toEqual(supported);});
});
