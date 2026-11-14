import {expect,it} from 'vitest';
import {overlayLegacyPermission as overlay} from './legacy-permission-overlay';

it.each(['claude','codex'] as const)('retains unrelated saved argv and overlays full then ask only on run copies (%s)',kind=>{
  const input=kind==='claude'?['--max-turns','7','--permission-mode=bypassPermissions']:['--search','--dangerously-bypass-approvals-and-sandbox'];
  const original=[...input],plan=overlay(kind,input,'ask');expect(input).toEqual(original);
  expect(plan.permission.id).toBe('ask');expect(plan.args).toEqual(kind==='claude'?['--max-turns','7','--permission-mode','default']:['--search','-s','workspace-write','-a','on-request','-c','approvals_reviewer="user"']);
});
it('never parses a Claude prompt or path value as a host/permission option',()=>{
  const plan=overlay('claude',['--append-system-prompt','--permission-mode','--add-dir','--dangerously-skip-permissions'],'full');
  expect(plan.args).toEqual(['--append-system-prompt','--permission-mode','--add-dir','--dangerously-skip-permissions','--permission-mode','bypassPermissions']);
});
it('normalizes Codex short and equals options and removes direct config permission overrides',()=>{
  const plan=overlay('codex',['-s=read-only','--ask-for-approval','never','-c','"approvals_reviewer"="auto_review"','--config=sandbox_mode="danger-full-access"','-c','model_reasoning_effort="high"'],'ask');
  expect(plan.args).toEqual(['-c','model_reasoning_effort="high"','-s','workspace-write','-a','on-request','-c','approvals_reviewer="user"']);
});
it.each(['claude','codex'] as const)('pins a valid restore model without mutating original model arguments (%s)',kind=>{
  const args=kind==='claude'?['--model','original']:['-m=original','-c','model="other"'];
  const copy=[...args],plan=overlay(kind,args,'ask','last-used');expect(args).toEqual(copy);
  expect(plan.model).toBe('last-used');expect(plan.args.slice(-2)).toEqual([kind==='claude'?'--model':'-m','last-used']);expect(plan.args).not.toContain('original');expect(plan.args).not.toContain('model="other"');
});
it('falls unsupported Claude auto back through the existing permission generator',()=>{expect(overlay('claude',[],'auto').permission).toEqual({id:'ask',args:['--permission-mode','default']});});
it.each([
 ['claude',['--','PUBLIC_PRIVATE_KEY']],['claude',['--settings','PUBLIC_PRIVATE_KEY']],['claude',['--unknown','PUBLIC_PRIVATE_KEY']],
 ['claude',['--permission-mode','PUBLIC_PRIVATE_KEY']],['codex',['--profile','PUBLIC_PRIVATE_KEY']],['codex',['-c','permissions={PUBLIC_PRIVATE_KEY=true}']],
 ['codex',['-c','sandbox_mode="read-only"\nother="PUBLIC_PRIVATE_KEY"']],['codex',['--','PUBLIC_PRIVATE_KEY']],['codex',['-m']],
] as const)('rejects ambiguous legacy boundaries before launch with no credential echo (%s %j)',(kind,args)=>{
  expect(()=>overlay(kind,args,'ask')).toThrow('权限边界');try{overlay(kind,args,'ask');}catch(error){expect(String(error)).not.toContain('PUBLIC_PRIVATE_KEY');}
});
