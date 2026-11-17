#!/usr/bin/env python3
"""Prepare/run an archived M14 experiment outside the checkout.

Only copied scripts are relocated. Content-addressed runtime assets are immutable.
Dependencies are installed separately using the archived locks; no credentials are
read or copied. --prepare-only never starts a model, Electron or a build.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

BASE = Path(__file__).resolve().parent
REPO = next(p for p in BASE.parents if (p / 'src/main/db/schema.ts').exists())
PROTECTED = {'mcp-bridge.cjs', 'actual.cjs', 'actual-claude.cjs', 'actual-codex.cjs'}

def digest(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()

def immutable(p):
    return 'bundles' in p.parts or p.name in PROTECTED

def relocate(text, mapping):
    for old, new in sorted(mapping.items(), key=lambda x: -len(x[0])):
        text = text.replace(old, str(new))
    return text

def prepare(name, out, environment, owner, sdk, modules, t3):
    source = BASE / name
    if not source.is_dir() or source.parent != BASE or not name.startswith('2026'):
        raise ValueError('Choose a current experiment from 实验目录.json')
    out = Path(out).resolve()
    if out.exists() or out == REPO or REPO in out.parents:
        raise ValueError('Output must be a NEW directory outside the checkout')
    out.mkdir(parents=True)
    work = out / 'experiment'
    shutil.copytree(source, work, symlinks=True)
    # Extract only ordinary members and safe in-archive links. Original archives
    # stay in place for provenance. Python data_filter rejects path escapes.
    for archive in sorted(source.glob('*.tar.gz')):
        with tarfile.open(archive) as tf:
            tf.extractall(work, filter='data')
    mapping = {
        '/Users/hx/projects/SmartDD': REPO,
        '/private/tmp/willyou-m14-owner-probe/node_modules/better-sqlite3': modules / 'better-sqlite3',
        '/private/tmp/willyou-m14-owner-probe': owner,
        '/private/tmp/willyou-m14-global-f3zh527k': sdk,
        '/private/tmp/willyou-m10-config-fix-9_31ogou/node_modules': modules,
        '/opt/homebrew/bin/node': shutil.which('node') or 'node',
    }
    for p in (environment / 'tmp').iterdir():
        if p.is_dir():
            mapping.setdefault('/private/tmp/' + p.name, p)
    # A referenced shared input may be immutable: keep its restored bytes. The
    # selected experiment's own old root must instead address this fresh copy.
    original_roots = set()
    for p in work.rglob('*.mjs'):
        if immutable(p):
            continue
        for m in re.finditer(r'/private/tmp/(willyou-m14-[A-Za-z0-9_-]+)', p.read_text(errors='surrogateescape')):
            if (environment / 'tmp' / m[1] / p.name).exists():
                original_roots.add(m[1])
    # Catalog picks the original root using hashes/README, not modification time.
    catalog = json.loads((BASE / '实验目录.json').read_text())
    entry = next(e for e in catalog['experiments'] if e['name'] == name)
    if entry.get('originalRoot'):
        mapping[entry['originalRoot']] = work
    mapping['/Users/hx/projects/t3code'] = t3
    mapping['/Users/hx/hx/3.GitHubProject/t3code'] = t3
    changes = []
    before = {str(p.relative_to(work)): digest(p) for p in work.rglob('*') if p.is_file() and immutable(p)}
    stub = out / 'pty-unavailable.cjs'
    stub.write_text("exports.spawn=()=>{throw Error('PTY is unavailable in this programmatic research fixture')};\n")
    # Every named esbuild build call passes through this wrapper, including
    # bridge/driver builds, not only the historical profile build.
    for p in work.rglob('*'):
        if not p.is_file() or p.is_symlink() or immutable(p) or p.suffix not in ['.mjs', '.js', '.py', '.ts', '.sh']:
            continue
        text = p.read_text(errors='surrogateescape')
        updated = relocate(text, mapping)
        # Replace every named esbuild build import with an alias-injecting wrapper.
        pattern = r'''import\s*\{\s*build\s*\}\s*from\s*(['"])([^'"]*esbuild[^'"]*)\1\s*;'''
        def wrap(m):
            return (f'import {{build as __m14Build}} from {json.dumps(m[2])};'
                    f'const build=(o)=>__m14Build({{...o,alias:{{...o.alias,"node-pty":{json.dumps(str(stub))}}}}});')
        updated = re.sub(pattern, wrap, updated)
        named = r'''import\s*\{([^}]+)\}\s*from\s*(['"])([^'"]*esbuild[^'"]*)\2\s*;'''
        def wrap_named(m):
            found=re.search(r'\bbuild(?:\s+as\s+(\w+))?\b',m[1])
            if not found:return m[0]
            alias=found[1] or 'build'
            if alias.startswith('__m14'):return m[0]
            fields=m[1][:found.start()]+'build as __m14Build'+m[1][found.end():]
            return (f'import {{{fields}}} from {json.dumps(m[3])};'
                    f'const {alias}=(o)=>__m14Build({{...o,alias:{{...o.alias,"node-pty":{json.dumps(str(stub))}}}}});')
        updated=re.sub(named,wrap_named,updated)
        # Namespace/default imports also occur in historical build drivers.
        namespace = r'''import\s+(?:\*\s+as\s+)?(\w+)\s+from\s*(['"])([^'"]*esbuild[^'"]*)\2\s*;'''
        def wrap_namespace(m):
            name=m[1]
            if name.startswith('__m14'):return m[0]
            return (f'import * as __m14Esbuild from {json.dumps(m[3])};'
                    f'const {name}={{...__m14Esbuild,build:(o)=>__m14Esbuild.build({{...o,alias:{{...o.alias,"node-pty":{json.dumps(str(stub))}}}}})}};')
        updated=re.sub(namespace,wrap_namespace,updated)
        if updated != text:
            p.unlink()
            p.write_text(updated, errors='surrogateescape')
            changes.append(str(p.relative_to(work)))
    after = {str(p.relative_to(work)): digest(p) for p in work.rglob('*') if p.is_file() and immutable(p)}
    if before != after:
        raise ValueError('Immutable runtime bytes changed')
    nm=work/'node_modules'
    if nm.is_symlink():nm.unlink()
    if not nm.exists():nm.symlink_to(owner/'node_modules',target_is_directory=True)
    receipt={'experiment':name,'originalArchives':entry['archives'],'rewrittenScripts':changes,
             'immutableSha256':after,'immutableBytesUnchanged':before==after,
             'environment':str(environment),'repo':str(REPO),'scope':'prepared copy, not executed'}
    (out/'preparation.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
    import gzip
    for frames in source.glob('*-frames.json.gz'):
        (work / frames.name.removesuffix('.gz')).write_bytes(gzip.decompress(frames.read_bytes()))
    for target in [work, work / 'probe']:
        if not target.exists():
            continue
        link = target / 'node_modules'
        if link.is_symlink():
            link.unlink()
        if not link.exists():
            link.symlink_to(modules)
    return work, entry

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('experiment')
    p.add_argument('--out', required=True)
    p.add_argument('--environment', type=Path, default=os.environ.get('M14_ENV_ROOT'))
    p.add_argument('--owner', type=Path, default=os.environ.get('M14_OWNER_ROOT'))
    p.add_argument('--sdk', type=Path, default=os.environ.get('M14_SDK_ROOT'))
    p.add_argument('--node-modules', type=Path, default=os.environ.get('M14_NODE_MODULES'))
    p.add_argument('--t3', type=Path, default=os.environ.get('M14_T3_ROOT'))
    p.add_argument('--run', help='explicit relative entry from the per-experiment replay instructions')
    p.add_argument('--mode', help='plugin-exceptions: deny/uninstall/incompatible')
    p.add_argument('--electron', type=Path, default=os.environ.get('M14_ELECTRON_BIN'))
    p.add_argument('--prepare-only', action='store_true')
    a = p.parse_args()
    required = ['environment', 'owner', 'sdk', 'node_modules', 't3']
    for key in required:
        if getattr(a, key) is None:
            p.error('Set --' + key.replace('_', '-') + ' or its documented M14 environment variable')
    work, entry = prepare(a.experiment, a.out, a.environment.resolve(), a.owner.resolve(), a.sdk.resolve(), a.node_modules.resolve(), a.t3.resolve())
    print(json.dumps({'prepared': str(work), 'entry': entry.get('entry'), 'runner': entry.get('runner')}, ensure_ascii=False))
    if a.run and not a.prepare_only:
        target = (work / a.run).resolve()
        if work.resolve() not in target.parents or not target.is_file():
            raise ValueError('Entry must be a file inside the prepared copy')
        runner = str(a.electron) if entry['runner'] == 'electron' and a.electron else shutil.which('python3') if entry['runner']=='python' else shutil.which('node') if entry['runner']=='node' else None
        if not runner:
            raise ValueError('Missing explicit Electron path or Node executable')
        if entry.get('modeRequired') and a.mode not in ['deny', 'uninstall', 'incompatible']:
            raise ValueError('plugin-exceptions requires --mode deny|uninstall|incompatible')
        cmd = [runner, str(target), *([a.mode] if a.mode else []), *([str(Path(a.out)/'output')] if target.name=='handoff_probe.py' else [])]
        with (Path(a.out) / 'execution.log').open('w') as log:
            result = subprocess.run(cmd, cwd=target.parent, stdout=log, stderr=subprocess.STDOUT, timeout=600)
        (Path(a.out) / 'execution.json').write_text(json.dumps({'cmd': cmd, 'exitCode': result.returncode,
             'scope': 'new execution, original evidence untouched'}) + '\n')
        raise SystemExit(result.returncode)

if __name__ == '__main__':
    main()
