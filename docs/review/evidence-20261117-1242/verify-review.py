from pathlib import Path
import datetime, hashlib, json, re, subprocess

repo = Path.cwd()
out = Path(__file__).resolve().parent
report = out.parent / 'review-20261117-1242.md'
baseline = json.loads((out / 'input-baseline.json').read_text())
changed = []
for name, expected in baseline['files'].items():
    file = repo / name
    actual = hashlib.sha256(file.read_bytes()).hexdigest() if file.is_file() else None
    if actual != expected['sha256']:
        changed.append({'path': name, 'expected': expected['sha256'], 'actual': actual})

integrity = out / 'input-integrity.json'
integrity.write_text('{}\n')
missing = []
for file in [report, out / 'README.md']:
    for target in re.findall(r'\]\(([^)]+)\)', file.read_text()):
        if re.match(r'(?:https?|mailto):', target):
            continue
        clean = target.split('#', 1)[0]
        if clean and not (file.parent / clean).exists():
            missing.append({'file': str(file.relative_to(repo)), 'target': target})
headings = re.findall(r'^### (DOC\d+) · (中|低) ·', report.read_text(), re.M)
branch = subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip()
head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip()
result = {
    'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'branch': branch, 'head': head, 'checkedInputs': len(baseline['files']),
    'changedInputs': changed, 'reportLinksMissing': missing,
    'findings': {'total': len(headings), 'medium': sum(s == '中' for _, s in headings), 'low': sum(s == '低' for _, s in headings)},
    'productionDiffSinceHead': subprocess.check_output(['git', 'diff', '--name-only', '--', 'src'], text=True).splitlines(),
}
integrity.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False))
raise SystemExit(bool(changed or missing or len(headings) != 2 or {i for i, _ in headings} != {'DOC01', 'DOC02'} or branch != baseline['branch'] or head != baseline['head']))
