import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// Each CI matrix runner compiles its own architecture; customers need no compiler/runtime.
if (process.platform === 'darwin') {
  const output = resolve('out/native');
  mkdirSync(output, { recursive: true });
  execFileSync('xcrun', ['clang', '-fobjc-arc', '-O2', '-mmacosx-version-min=12.0', '-arch', process.arch === 'arm64' ? 'arm64' : 'x86_64', '-framework', 'AppKit', '-framework', 'ApplicationServices', 'native/voice/bridge.m', '-o', `${output}/smartdd-voice`], { stdio: 'inherit' });
}
