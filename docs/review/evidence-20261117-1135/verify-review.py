from pathlib import Path
import datetime, hashlib, json, re, subprocess

repo = Path.cwd()
out = Path(__file__).resolve().parent
report = out.parent / 'review-20261117-1135.md'
baseline = json.loads((out / 'input-baseline.json').read_text())
extra = json.loads((out / 'production-reference-baseline.json').read_text())
original = baseline['files'] | extra
changed = []
for name, expected in original.items():
    file = repo / name
    actual = hashlib.sha256(file.read_bytes()).hexdigest() if file.is_file() else None
    if actual != expected['sha256']:
        changed.append({'path': name, 'expected': expected['sha256'], 'actual': actual})

# Create this review-owned output before scanning its link in the report.
integrity = out / 'input-integrity.json'
integrity.write_text('{}\n')
links = []
for file in [report, out / 'README.md']:
    source = file.read_text()
    targets = re.findall(r'\]\(([^)]+)\)', source)
    targets += re.findall(r'^\[[^\]]+\]:\s+(\S+)\s*$', source, re.M)
    for target in targets:
        if re.match(r'(?:https?|mailto):', target):
            continue
        clean = target.split('#', 1)[0]
        if clean and not (file.parent / clean).exists():
            links.append({'file': str(file.relative_to(repo)), 'target': target})
headings = re.findall(r'^### (N\d+) · (中|低) ·', report.read_text(), re.M)
result = {
    'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'branch': subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip(),
    'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
    'initialInputs': len(baseline['files']),
    'extraInputs': len(extra),
    'checkedInputs': len(original),
    'changedInputs': changed,
    'reportLinksMissing': links,
    'findings': {'total': len(headings), 'medium': sum(s == '中' for _, s in headings), 'low': sum(s == '低' for _, s in headings)},
    'productionDiffSinceHead': subprocess.check_output(['git', 'diff', '--name-only', '--', 'src'], text=True).splitlines(),
}
integrity.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False))
raise SystemExit(bool(changed or links or len(headings) != 1 or result['head'] != baseline['head'] or result['branch'] != baseline['branch']))
