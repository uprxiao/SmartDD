#!/usr/bin/env python3
"""Check research syntax, links, historical snapshots and private artifact handling."""
import ast
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import stat
import subprocess
from urllib.parse import unquote

HERE=Path(__file__).resolve().parent
STAGE=HERE.parents[2]
ROOT=STAGE.parents[2]


def main():
    errors=[];checks={}
    python_files=sorted([p for directory in [HERE,STAGE/'技研/禅道列表接口复验_20261017'] for p in directory.rglob('*.py')])
    for p in python_files:
        try:ast.parse(p.read_text(),filename=str(p))
        except Exception as exc:errors.append({'type':'python_parse','file':p.name,'error':type(exc).__name__})
    checks['researchPythonSyntaxFiles']=len(python_files)
    json_files=sorted(STAGE.rglob('*.json'))
    for p in json_files:
        try:json.loads(p.read_text())
        except Exception as exc:errors.append({'type':'json_parse','file':str(p.relative_to(STAGE)),'error':type(exc).__name__})
    checks['stageJSONFiles']=len(json_files)
    checked_links=0
    for p in STAGE.rglob('*.md'):
        for match in re.finditer(r'!?\[[^\]\n]*\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"]*")?\)',p.read_text()):
            raw=match.group(1).strip('<>')
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:',raw) and not raw.startswith('/'):continue
            target=unquote(raw.split('#')[0].split('?')[0])
            target=re.sub(r':\d+$','',target)
            if not target:continue
            checked_links+=1
            dest=Path(target) if target.startswith('/') else p.parent/target
            if not dest.exists():errors.append({'type':'markdown_link','file':str(p.relative_to(STAGE)),'target':target})
    checks['localMarkdownLinks']=checked_links
    v2=json.loads((STAGE/'调研/证据/m10-research-v2-manifest.json').read_text())
    count=0
    for item in v2['stageFiles']:
        if not item.get('sha256'):continue
        p=ROOT/'release/m10-research/v2-archive-before-audit-20261017-1559'/item['path']
        count+=1
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:
            errors.append({'type':'v2_snapshot','file':item['path']})
    checks['historicalV2StageHashes']=count
    audit=json.loads((STAGE/'验收/证据/m10-file-inventory-audit-20261017-1559.json').read_text())
    count=0
    for item in audit['stage']['files']:
        if not item.get('sha256'):continue
        relative=Path(item['path']).relative_to(STAGE.relative_to(ROOT))
        p=ROOT/'release/m10-research/audit-20261017-1606-stage-snapshot'/relative
        count+=1
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:
            errors.append({'type':'audit_snapshot','file':str(relative)})
    checks['historicalAuditStageHashes']=count
    previous=ROOT/'release/m10-research/before-my-work-recheck-20261017'
    prior_manifest=json.loads((previous/'验收/证据/m10-real-readiness-file-manifest-20261017.json').read_text())
    count=0
    for item in prior_manifest['stageFiles']:
        if not item.get('sha256'):continue
        relative=Path(item['path']).relative_to(STAGE.relative_to(ROOT));p=previous/relative
        count+=1
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:
            errors.append({'type':'before_work_recheck_snapshot','file':str(relative)})
    checks['beforeWorkRecheckStageHashes']=count
    metadata=json.loads((STAGE/'调研/证据/zentao-biz13-reuse-metadata.json').read_text())
    checks['legacyReferenceHashes']=len(metadata['local_sources'])
    for item in metadata['local_sources']:
        p=Path(item['path'])
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:
            errors.append({'type':'legacy_source_changed','file':p.name})
    private=ROOT/'release/m10-research/live-verification-20261017'
    directory=private/'zentao-private-targeted'
    bad_modes=0;private_count=0
    for p in [directory]+list(directory.rglob('*')):
        private_count+=1
        expected=0o700 if p.is_dir() else 0o600
        if stat.S_IMODE(p.stat().st_mode)!=expected:bad_modes+=1
    checks['privateBugArtifactsChecked']=private_count
    checks['privateBugArtifactsModesValid']=bad_modes==0
    if bad_modes:errors.append({'type':'private_artifact_modes','count':bad_modes})
    checks['privateBusinessPathsIgnored']=all(subprocess.run(['git','check-ignore','-q',str(p)],cwd=ROOT).returncode==0
        for p in [directory,private/'smtp-test-draft.eml',private/'targeted-export-resume.stdout.log'])
    if not checks['privateBusinessPathsIgnored']:errors.append({'type':'private_git_ignore'})
    clean=subprocess.run(['git','diff','--check'],cwd=ROOT,capture_output=True).returncode==0
    checks['gitDiffWhitespaceCheck']=clean
    if not clean:errors.append({'type':'git_diff_whitespace'})
    report={'schema':'m10-public-research-validation-v1','at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'ok':not errors,'checks':checks,'errors':errors,
            'limits':['Document/source integrity only; no production App tests are represented by this report.',
                      'Private business filenames, payloads and credential values are not printed or stored in public validation results.',
                      'Current machine-manifest hashes are checked after regeneration to avoid self-reference.']}
    (HERE/'public-evidence-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False))
    raise SystemExit(0 if report['ok'] else 1)


if __name__=='__main__':main()
