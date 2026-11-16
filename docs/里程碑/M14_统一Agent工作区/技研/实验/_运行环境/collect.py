import collections
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

BASE = Path('/private/tmp')
OUT = BASE / 'm14-runtime-package-20261116/payload'
OUT.mkdir(exist_ok=True)
ROOT_SKIP = {'willyou-m14-global-f3zh527k', 'willyou-m14-submit-scope'}
SOURCE_DIRS = {'bundles', 'resources', 'sources', 'overlay', 'baseline-inputs', 'first-failure-source', 'current-ui', 'codex-schema', 'codex-schema-experimental', 'archive-fixtures', 'audit-schema', 'host-fixture-correction'}
SUFFIXES = {'.mjs', '.cjs', '.js', '.ts', '.tsx', '.jsx', '.py', '.json', '.sql', '.variant', '.sh', '.bash', '.zsh', '.rs', '.c', '.cc', '.cpp', '.h', '.mm', '.swift', '.html', '.css', '.yaml', '.yml', '.toml', '.tmpl', '.conf', '.md'}
DENY_DIRS = {'node_modules', '.git', 'home', '.codex', '.claude', '.agents', '__pycache__', 'userData', 'userdata', 'sessionData', 'Cache'}
SECRET = re.compile(rb'(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{20,}|(?:Bearer )[A-Za-z0-9._-]{25,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')
LITERAL = re.compile(rb'(?i)[\"\x27]?(?:access_token|refresh_token|api_key|apiKey|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY)[\"\x27]?\s*[:=]\s*[\"\x27]([A-Za-z0-9._-]{20,})[\"\x27]')
records, exclusions, redactions, symlinks = [], [], [], []
content = {}
roots = [p for p in sorted(BASE.glob('willyou-m14-*')) if p.is_dir() and p.name not in ROOT_SKIP]

def sanitize(data, name):
    safe = lambda m: m.group(1).startswith((b'unselected-', b'synthetic-')) or m.group(1) in {b'ANTHROPIC_AUTH_TOKEN', b'ANTHROPIC_API_KEY'}
    count = len(SECRET.findall(data)) + sum(not safe(m) for m in LITERAL.finditer(data))
    if count:
        data = SECRET.sub(b'[REDACTED_CREDENTIAL]', data)
        data = LITERAL.sub(lambda m: m.group(0) if safe(m) else m.group(0).replace(m.group(1), b'[REDACTED_CREDENTIAL]'), data)
        redactions.append({'path': name, 'matches': count})
    return data

def add_file(tf, source, destination):
    data = source.read_bytes()
    original = hashlib.sha256(data).hexdigest()
    data = sanitize(data, destination)
    digest = hashlib.sha256(data).hexdigest()
    info = tarfile.TarInfo(destination)
    info.mode = 0o755 if source.stat().st_mode & 0o111 else 0o644
    info.mtime = 0
    record = {'path': destination, 'source': str(source), 'bytes': len(data), 'sha256': digest, 'sourceSha256': original, 'mode': oct(info.mode)}
    key = (digest, info.mode)
    if key in content:
        info.type = tarfile.LNKTYPE
        info.linkname = content[key]
        record['hardlinkTo'] = info.linkname
        tf.addfile(info)
    else:
        content[key] = destination
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))
    records.append(record)

with tarfile.open(OUT / 'tmp-sources.tar.gz', 'w:gz', compresslevel=6) as tf:
    for root in roots:
        for directory, dirs, files in os.walk(root, followlinks=False):
            parent = Path(directory)
            kept = []
            for d in sorted(dirs):
                p = parent / d
                reason = None
                if p.is_symlink():
                    symlinks.append({'path': str(p), 'target': str(p.resolve())})
                    reason = 'symlink-not-followed'
                elif parent == root and d not in SOURCE_DIRS:
                    reason = 'runtime-output-or-publication-copy-or-dependency'
                elif d in DENY_DIRS or 'home' in d.lower() or d.startswith(('attempt-', 'recovery-')):
                    reason = 'isolated-home-or-dependency-or-runtime-output'
                if reason:
                    exclusions.append({'path': str(p), 'reason': reason})
                else:
                    kept.append(d)
            dirs[:] = kept
            for f in sorted(files):
                p = parent / f
                if p.is_symlink():
                    symlinks.append({'path': str(p), 'target': str(p.resolve())})
                    continue
                if f in {'auth.json', 'credentials.json', '.env'} or '.sqlite' in f or p.suffix not in SUFFIXES:
                    # Native helpers explicitly present in source resources remain inputs.
                    if p.suffix == '' and (parent != root or f in {'willyou-app', 'audit-schema'}) and p.read_bytes()[:4] in [b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe']:
                        pass
                    else:
                        exclusions.append({'path': str(p), 'reason': 'not-source-or-config; binary helper collected separately where specified'})
                        continue
                add_file(tf, p, 'tmp/' + str(p.relative_to(BASE)))

(OUT / 'bin').mkdir(exist_ok=True)
binary = BASE / 'willyou-m14-owner-probe/process-identity'
shutil.copy2(binary, OUT / 'bin/process-identity')
deps = []
for root in roots:
    if (root / 'package.json').exists() or root.name == 'willyou-m14-browser-native-cli-probe':
        deps.append(root)
    for d in ['dependencies', 'electron-deps']:
        if (root / d / 'package.json').exists():
            deps.append(root / d)
deps.append(BASE / 'willyou-m10-config-fix-9_31ogou')
dependency_records, npm_cache = [], {}
for root in deps:
    target = OUT / 'deps' / root.relative_to(BASE)
    target.mkdir(parents=True, exist_ok=True)
    modules = root / 'node_modules'
    effective = modules.resolve().parent if modules.exists() else root
    metadata = {'originalDirectory': str(root), 'nodeModulesRealpath': str(modules.resolve()), 'manifestDirectory': str(effective), 'manifests': []}
    for name in ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'npm-shrinkwrap.json']:
        src = (root / name) if (root / name).exists() else (effective / name)
        if src.exists():
            (target / name).write_bytes(sanitize(src.read_bytes(), str((target / name).relative_to(OUT))))
            metadata['manifests'].append({'file': name, 'source': str(src)})
    key = str(effective)
    if key not in npm_cache:
        result = subprocess.run(['npm', 'ls', '--all', '--json', '--offline'], cwd=effective, capture_output=True, timeout=90)
        try:
            parsed = json.loads(result.stdout)
        except ValueError:
            parsed = {'error': 'npm ls did not return JSON', 'exitCode': result.returncode}
        # npm stdout is a package graph only; stderr is deliberately not archived.
        npm_cache[key] = (json.dumps(parsed, ensure_ascii=False, indent=2).encode() + b'\n', result.returncode)
    raw, code = npm_cache[key]
    (target / 'npm-ls.json').write_bytes(sanitize(raw, str((target / 'npm-ls.json').relative_to(OUT))))
    metadata['npmLsExitCode'] = code
    (target / 'origin.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
    dependency_records.append(metadata)

report = {'format': 1, 'scope': 'Root scripts/configs and explicit source directories from surviving M14 temporary roots; excludes outputs, dependency trees and publication mirrors. Credentials redacted when found.', 'excludedRoots': sorted(ROOT_SKIP), 'sourceDirectoriesIncluded': sorted(SOURCE_DIRS), 'rootCount': len(roots), 'fileCount': len(records), 'logicalBytes': sum(r['bytes'] for r in records), 'uniqueContentFiles': len(content), 'files': records, 'excluded': exclusions, 'symlinks': symlinks, 'dependencies': dependency_records, 'redactions': redactions}
(OUT / 'collection-manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: report[k] for k in ['rootCount', 'fileCount', 'logicalBytes', 'uniqueContentFiles', 'redactions']}, ensure_ascii=False))
print('archiveBytes', (OUT / 'tmp-sources.tar.gz').stat().st_size)
print('dependencyDirectories', len(dependency_records), 'distinctNpmGraphs', len(npm_cache))
