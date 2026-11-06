#!/usr/bin/python3
"""Root-only draft: same source029 files/modes snapshot schema; no build logic."""
import argparse, datetime, hashlib, json, os, shutil, stat
from pathlib import Path

REPO = Path('/Users/liubu/hx/4.uprxiao/SmartDD')
BASE = Path('/private/tmp/willyou-m12-cache-fix-source-029/source-inputs.json')
DEST = Path('/private/tmp/willyou-m12-t091-source-030')
ALLOWED_HIDDEN = set()
def sha(p):
    h = hashlib.sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
    return h.hexdigest()
def owned_file(rel):
    p = Path(rel)
    if p.is_absolute() or '..' in p.parts or (any(x.startswith('.') for x in p.parts) and rel not in ALLOWED_HIDDEN):
        raise ValueError('Non-source or unsafe relative path: ' + rel)
    full = REPO / p
    if full.is_symlink() or not full.is_file() or full.resolve() != full:
        raise ValueError('Source link/missing/special file: ' + rel)
    return full
def main():
    p=argparse.ArgumentParser()
    p.add_argument('--execute',action='store_true',required=True)
    p.add_argument('--delta',type=Path,required=True)
    p.add_argument('--delta-sha',required=True)
    p.add_argument('--commit',required=True)
    a=p.parse_args()
    assert os.environ.get('WILLYOU_APP026_ROOT_EXCLUSIVE') == '1', 'Root exclusive build lease required'
    assert os.environ.get('WILLYOU_APP026_REGRESSIONS_ACCEPTED') == '1', 'Root must first accept actual regressions'
    assert sha(BASE)=='8a1211f2add9d0ed8e5ba30a041a75c9c2ab2162d1540069ad9e8d40e0fa497a'
    assert sha(a.delta)==a.delta_sha, 'Final Root-approved delta SHA mismatch'
    base=json.loads(BASE.read_text()); delta=json.loads(a.delta.read_text())['files']
    ALLOWED_HIDDEN.update(base['files'])  # Exact previously frozen names only, never credential discovery.
    assert delta and all(len(v)==64 for v in delta.values())
    names=sorted(set(base['files'])|set(delta)); files={}; modes={}
    for rel in names:
        f=owned_file(rel); files[rel]=sha(f); modes[rel]=stat.S_IMODE(f.stat().st_mode)
        if rel in delta: assert files[rel]==delta[rel], 'Final frozen delta differs: '+rel
        else:
            assert files[rel]==base['files'][rel] and modes[rel]==base['modes'][rel], 'Undeclared source change: '+rel
    assert not DEST.exists(), 'Preserve original attempt; choose a reviewed new destination instead'
    (DEST/'source').mkdir(parents=True)
    for rel in names:
        target=DEST/'source'/rel; target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(owned_file(rel),target)
        assert sha(target)==files[rel] and stat.S_IMODE(target.stat().st_mode)==modes[rel]
    assert all(sha(owned_file(x))==files[x] and stat.S_IMODE(owned_file(x).stat().st_mode)==modes[x] for x in names), 'Source moved during freeze'
    changed=[x for x in names if x in base['files'] and (files[x]!=base['files'][x] or modes[x]!=base['modes'][x])]
    record={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'commit':a.commit,'source':str(DEST/'source'),
        'priorManifestSha256':sha(BASE),'scope':'T091 approved default-browser creation and marker-only inactive CLI; Root accepted regressions first',
        'files':files,'modes':modes,'inventory':{'changed':changed,'added':[x for x in names if x not in base['files']],'removed':[],'unchanged':len(names)-len(changed)-len([x for x in names if x not in base['files']])},
        'dirtyProduction':changed,'approvedDelta':str(a.delta),'approvedDeltaSha256':a.delta_sha}
    out=DEST/'source-inputs.json'; out.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'sourceManifest':str(out),'sha256':sha(out),'files':len(files)},ensure_ascii=False))
if __name__=='__main__': main()
