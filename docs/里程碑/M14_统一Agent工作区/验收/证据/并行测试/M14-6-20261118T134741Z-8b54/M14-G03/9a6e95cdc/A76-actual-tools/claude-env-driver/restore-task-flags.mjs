import assert from 'node:assert/strict';
import {isM14PreEntryRun} from '../helpers/scripts/lib/electron-isolation-paths.mjs';

const taskKey='CLAUDE_CODE_ENABLE_TASKS';
const todoKey='CLAUDE_CODE_ENABLE_TODO_TOOLS';

export function restoreA76TaskFlags(env,{executable,userData,home,inspectMain,startupMainHook,nodeModeNegative}) {
  assert(inspectMain&&typeof startupMainHook==='function'&&!nodeModeNegative);
  assert(isM14PreEntryRun(executable,userData,home)&&/\/g04\/attempt-\d{3}\//.test(home));
  assert.equal(env.HOME,home);
  assert.equal(env.SMARTDD_USER_DATA,userData);
  assert(!Object.keys(env).some(key=>/^(CLAUDE_CODE_|CLAUDECODE|ANTHROPIC_|OPENAI_)/.test(key)),'Run normal secret filtering first');
  assert(!Object.hasOwn(env,'M14_LIVE_DEEPSEEK_KEY'));
  env[taskKey]='1';
  env[todoKey]='1';
  return env;
}
