import assert from 'node:assert/strict';
import {fileURLToPath}from'node:url';import{isAbsolute,resolve}from'node:path';
export function nativeCwdPath(value){assert(typeof value==='string'&&value.length>0,'cwd required');if(value.startsWith('file:')){const u=new URL(value);assert(u.protocol==='file:'&&['','localhost'].includes(u.hostname)&&!u.search&&!u.hash&&!u.username&&!u.password,'Only local file cwd URL');value=fileURLToPath(u)}assert(isAbsolute(value)&&resolve(value)===value,'Canonical absolute cwd required');return value}

const nonempty=v=>typeof v==='string'&&v.length>0,copy=v=>structuredClone(v);
// A deliberately limited literal shell-word reader, never a shell evaluator.
// Compound/expanding commands do not prove a numeric CLI-child exit and stay diagnostic.
export function literalWords(text) {
  assert(nonempty(text) && !/[\r\n\0]/.test(text), 'nonliteral shell command');
  const words = []; let word = '', quote = null, active = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") { if (c === "'") quote = null; else word += c; continue; }
    if (quote === '"') {
      if (c === '"') { quote = null; continue; }
      assert(c !== '$' && c !== '`', 'shell expansion not accepted');
      if (c === '\\') { assert(i + 1 < text.length); const next = text[++i]; assert(['\\', '"'].includes(next), 'nonliteral double-quoted escape'); word += next; }
      else word += c;
      continue;
    }
    if (/\s/.test(c)) { if (active) { words.push(word); word = ''; active = false; } continue; }
    if (c === "'" || c === '"') { quote = c; active = true; continue; }
    if (c === '\\') { assert(i + 1 < text.length); word += text[++i]; active = true; continue; }
    assert(!/[;&|<>$`(){}*?\[\]~#]/.test(c), 'shell operator/expansion not accepted');
    word += c; active = true;
  }
  assert(!quote, 'unterminated shell quote');
  if (active) words.push(word);
  assert(words.length > 0);
  return words;
}
export function directCliCommand(item, expected) {
  const command = item.command;
  assert(Array.isArray(command) && command.length === 3 && ['/bin/zsh', '/bin/bash'].includes(command[0]) && ['-lc', '-c'].includes(command[1]) && typeof command[2] === 'string', 'not a supported direct CLI shell argv');
  const argv = literalWords(command[2]);
  assert(argv[0] === 'willyou-app' || (nonempty(expected.cliExecutable) && argv[0] === expected.cliExecutable), 'typed command is not the actual direct willyou-app invocation');
  return {command: command[2], shellArgv: copy(command), cliArgv: argv};
}

// Native cli.mm emits one JSON result and its exact code-only stderr diagnostic on refusal.
export function parseNativeCliJSON(text){assert(typeof text==='string');let json=text.trim(),diagnostic=null;try{return{value:JSON.parse(json),diagnostic}}catch{}const prefix=/^willyou-app: ([A-Z][A-Z0-9_]{0,63})\n/.exec(json),suffix=/\nwillyou-app: ([A-Z][A-Z0-9_]{0,63})$/.exec(json);assert(Boolean(prefix)!==Boolean(suffix),'Only one exact Native code diagnostic may accompany JSON');if(prefix){diagnostic=prefix[1];json=json.slice(prefix[0].length)}else{diagnostic=suffix[1];json=json.slice(0,-suffix[0].length)}const value=JSON.parse(json.trim());assert(value&&typeof value==='object'&&value.error?.code===diagnostic,'Native diagnostic code must match original error');return{value,diagnostic}}
