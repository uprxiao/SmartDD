import {describe,expect,it} from 'vitest';
import {MAC_FILE_WRITE_PROFILE,nativeFileCommand} from './write-confinement';
const executable='/Synthetic WillYou.app/native/willyou-files',root={path:'/private/tmp/project'},recoveryRoot={path:'/private/tmp/userdata/file-recovery/v1'};
describe('native save/copy kernel write authority',()=>{
 it('protects a save with exact project and recovery paths, retaining the fixed native executable',()=>{
  expect(nativeFileCommand(executable,{operation:'save',root,recoveryRoot},'darwin')).toEqual({executable:'/usr/bin/sandbox-exec',args:['-D','PROJECT_ROOT='+root.path,'-D','RECOVERY_ROOT='+recoveryRoot.path,'-p',MAC_FILE_WRITE_PROFILE,executable],writeConfined:true});
 });
 it('protects only the selected copy destination and recovery; source read authority is not a write grant',()=>{
  const command=nativeFileCommand(executable,{operation:'copy',root,destination:{root:{path:'/private/tmp/selected destination'}},recoveryRoot},'darwin');
  expect(command.args).toContain('PROJECT_ROOT=/private/tmp/selected destination');expect(command.args).not.toContain('PROJECT_ROOT='+root.path);expect(command.writeConfined).toBe(true);
 });
 it('passes quotes, shell-looking characters, spaces, Unicode and newlines only as opaque parameter arguments',()=>{
  const path="/private/tmp/'`$(no-command)` 中文🙂\nfolder";const command=nativeFileCommand(executable,{operation:'save',root:{path},recoveryRoot},'darwin');
  expect(command.args[1]).toBe('PROJECT_ROOT='+path);expect(command.args.at(-1)).toBe(executable);expect(command.args[5]).toBe(MAC_FILE_WRITE_PROFILE);expect(MAC_FILE_WRITE_PROFILE).not.toContain(path);
 });
 it.each([undefined,null,{}, {path:'relative'}, {path:'//server/share'}, {path:'/tmp/a/../b'}, {path:'/tmp//a'}, {path:'/tmp/a\0b'}, {path:'/'+ 'a'.repeat(32768)}])('refuses missing or noncanonical save roots before launching anything: %j',bad=>{
  expect(()=>nativeFileCommand(executable,{operation:'save',root:bad,recoveryRoot},'darwin')).toThrow('[UNTRUSTED]');
 });
 it('does not accept an absent copy destination or recovery descriptor',()=>{
  expect(()=>nativeFileCommand(executable,{operation:'copy',root,recoveryRoot},'darwin')).toThrow('[UNTRUSTED]');
  expect(()=>nativeFileCommand(executable,{operation:'save',root},'darwin')).toThrow('[UNTRUSTED]');
 });
 it.each(['read','stat','list','inspect-root','checkpoint','initialize-recovery','resolve-checkpoint'])('retains the existing native command for non-commit operation %s',operation=>{
  expect(nativeFileCommand(executable,{operation},'darwin')).toEqual({executable,args:[],writeConfined:false});
 });
 it('does not pretend to implement a Windows/Linux native commit policy',()=>{
  for(const platform of['win32','linux'] as const)expect(nativeFileCommand(executable,{operation:'save',root,recoveryRoot},platform).writeConfined).toBe(false);
 });
});

it('confines saved-copy cleanup to its destination and private recovery without a source write grant',()=>{
 const command=nativeFileCommand('/private/helper',{operation:'finish-copy',root:{path:'/private/output'},recoveryRoot:{path:'/private/recovery'}},'darwin');expect(command.writeConfined).toBe(true);expect(command.args).toContain('PROJECT_ROOT=/private/output');expect(command.args).toContain('RECOVERY_ROOT=/private/recovery');expect(()=>nativeFileCommand('/private/helper',{operation:'finish-copy',root:{path:'relative'},recoveryRoot:{path:'/private/recovery'}},'darwin')).toThrow('[UNTRUSTED]');
});
