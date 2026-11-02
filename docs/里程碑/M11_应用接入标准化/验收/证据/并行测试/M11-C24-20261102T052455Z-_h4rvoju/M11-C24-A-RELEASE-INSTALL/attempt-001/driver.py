import datetime
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import time

root = Path(__file__).resolve().parent
package = root / 'downloaded-release' / 'ci-artifact'
manifest = json.loads((package / 'manifest-mac-arm64.json').read_text())
assert manifest['version'] == '0.1.1' and manifest['commit'] == '44b46ca42cc8fff192c4fd8ae051431f369a2b8b'
assert manifest['dirty'] is False
item = manifest['files'][0]
image = package / item['file']

def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as data:
        while chunk := data.read(1024*1024): result.update(chunk)
    return result.hexdigest()

assert image.stat().st_size == item['size'] and digest(image) == item['sha256']
evidence = root / 'evidence' / 'release-install-001'
evidence.mkdir(exist_ok=False)
mount = root / 'release-mount-001'
mount.mkdir()
destination = root / 'Release Applications' / 'WillYou.app'
assert not destination.exists()
destination.parent.mkdir()
result = {'schema': 'willyou-v011-public-release-dmg-install-v1', 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'candidate': manifest['commit'], 'runId': 41399417380, 'artifactOrigin': 'github-release-arm64', 'image': str(image), 'imageSha256': item['sha256'],
          'installedApp': str(destination), 'mountReadonly': True, 'dailyAppOrDataChanged': False}
mounted = False
start = time.monotonic()

def inventory(directory):
    entries = {}
    for parent, directories, files in os.walk(directory, followlinks=False):
        for name in directories + files:
            path = Path(parent) / name
            relative = str(path.relative_to(directory))
            if path.is_symlink(): entries[relative] = ['link', os.readlink(path)]
            elif path.is_dir(): entries[relative] = ['directory']
            else: entries[relative] = ['file', path.stat().st_size, digest(path)]
    return entries

try:
    response = subprocess.run(['/usr/bin/hdiutil', 'attach', str(image), '-readonly', '-nobrowse', '-noautoopen',
                               '-mountpoint', str(mount), '-plist'], capture_output=True, check=True, timeout=120)
    parsed = plistlib.loads(response.stdout)
    assert any(entity.get('mount-point') == str(mount) for entity in parsed['system-entities'])
    mounted = True
    (evidence / 'mount.plist').write_bytes(response.stdout)
    source = mount / 'WillYou.app'
    assert source.is_dir()
    subprocess.run(['/usr/bin/ditto', str(source), str(destination)], check=True, timeout=180)
    source_entries = inventory(source)
    installed_entries = inventory(destination)
    assert source_entries == installed_entries
    result['identicalPayloadEntries'] = len(source_entries)
    result['payloadInventorySha256'] = hashlib.sha256(json.dumps(source_entries, sort_keys=True).encode()).hexdigest()
finally:
    if mounted:
        detached = subprocess.run(['/usr/bin/hdiutil', 'detach', str(mount)], capture_output=True, timeout=60)
        (evidence / 'detach.log').write_bytes(detached.stdout + detached.stderr)
        result['detached'] = detached.returncode == 0
        assert detached.returncode == 0

verification = subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(destination)],
                              capture_output=True, timeout=60)
(evidence / 'codesign.log').write_bytes(verification.stdout + verification.stderr)
assert verification.returncode == 0
info = plistlib.loads((destination / 'Contents/Info.plist').read_bytes())
assert info['CFBundleShortVersionString'] == '0.1.1'
result.update(version=info['CFBundleShortVersionString'], bundleId=info['CFBundleIdentifier'],
              asarSha256=digest(destination / 'Contents/Resources/app.asar'), codesign='passed',
              elapsedSeconds=round(time.monotonic()-start, 3), status='passed',
              finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
(evidence / 'result.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result))
