#!/usr/bin/env python3
"""Rebuild or verify small public ZenTao source excerpts, without network access."""
import argparse
import hashlib
import json
import subprocess
from pathlib import Path

COMMIT = "88d6de983014956235e3bf735d225106e38be551"
TAG = "zentaopms_22.0_20260318"
REPO = "https://github.com/easysoft/zentaopms"
DEST = Path(__file__).resolve().parent
ROOT = DEST.parents[5]

# One-based inclusive upstream line ranges; the files are deliberately partial.
GROUPS = {
    "01-地盘控制器.php.txt": [
        ("module/my/control.php", [(1, 12), (90, 96), (200, 228), (468, 493), (524, 530)]),
    ],
    "02-本人列表查询.php.txt": [
        ("module/bug/model.php", [(1, 12), (863, 869), (893, 917)]),
        ("module/story/model.php", [(1, 12), (3160, 3190)]),
    ],
    "03-路由分页与JSON.php.txt": [
        ("framework/base/router.class.php", [(1, 15), (2559, 2584)]),
        ("framework/api/router.class.php", [(1, 14), (300, 338), (713, 727)]),
        ("lib/dao/dao.class.php", [(1, 14), (372, 389)]),
        ("lib/base/pager/pager.class.php", [(1, 14), (176, 213)]),
        ("framework/base/control.class.php", [(1, 15), (687, 705)]),
        ("framework/api/control.class.php", [(1, 14), (80, 104), (116, 122)]),
    ],
    "04-认证与旧接口.php.txt": [
        ("framework/base/router.class.php", [(1, 15), (1202, 1243)]),
        ("api/v1/entries/tokens.php", [(1, 12), (49, 53)]),
        ("sdk/php/zentao.php", [(1, 12), (42, 56)]),
        ("module/api/control.php", [(1, 12), (923, 945)]),
        ("config/config.php", [(1, 12), (151, 152)]),
    ],
    "05-RESTv1列表边界.php.txt": [
        ("api/v1/entries/bugs.php", [(1, 12), (23, 52)]),
        ("api/v1/entries/stories.php", [(1, 12), (23, 61)]),
    ],
}
LICENSES = ["LICENSE.EN", "LICENSE.CN", "COPYING"]
ADDITIONAL_REFERENCES = [
    "config/apiv1.php", "config/apiv2.php", "www/index.php", "www/api.php",
    "module/my/ui/bug.html.php", "module/my/ui/story.html.php",
    "module/my/lang/zh-cn.php", "lib/pager/pager.class.php", "module/story/tao.php",
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def build(source):
    head = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if head != COMMIT:
        raise SystemExit(f"Unexpected source HEAD: {head}")
    dirty = subprocess.check_output(["git", "-C", str(source), "status", "--porcelain"], text=True)
    if dirty:
        raise SystemExit("Source checkout is modified; cannot treat it as the pinned upstream source")
    manifest = {"repository": REPO, "tag": TAG, "commit": COMMIT, "files": [], "licenses": []}
    outputs = {}
    for output, files in GROUPS.items():
        parts = [f"PUBLIC SOURCE RESEARCH EXCERPT — NOT RUNNABLE\nRepository: {REPO}\nTag: {TAG}\nCommit: {COMMIT}\nLicense: upstream ZPL 1.2 or AGPL 3.0; see LICENSE.*.upstream and COPYING.upstream.\n"]
        entries = []
        for filename, ranges in files:
            raw = (source / filename).read_bytes()
            lines = raw.decode("utf-8").splitlines(keepends=True)
            for first, last in ranges:
                snippet = "".join(lines[first - 1:last])
                if len(lines) < last:
                    raise SystemExit(f"Invalid range {filename}:{first}-{last}")
                url = f"{REPO}/blob/{COMMIT}/{filename}#L{first}-L{last}"
                parts.append(f"\n===== UPSTREAM {filename} L{first}-L{last} =====\n{url}\n{snippet}")
                if not snippet.endswith("\n"):
                    parts.append("\n")
                entries.append({"path": filename, "firstLine": first, "lastLine": last, "url": url, "upstreamFileSha256": sha(raw), "sliceSha256": sha(snippet.encode("utf-8"))})
        data = "".join(parts).encode("utf-8")
        outputs[output] = data
        manifest["files"].append({"output": output, "sha256": sha(data), "ranges": entries})
    for name in LICENSES:
        data = (source / name).read_bytes()
        output = name + ".upstream"
        outputs[output] = data
        manifest["licenses"].append({"output": output, "path": name, "sha256": sha(data), "url": f"{REPO}/blob/{COMMIT}/{name}"})
    version = (source / "VERSION").read_bytes()
    manifest["versionFile"] = {"value": version.decode("utf-8").strip(), "sha256": sha(version)}
    manifest["additionalReferences"] = [
        {"path": name, "sha256": sha((source / name).read_bytes()), "url": f"{REPO}/blob/{COMMIT}/{name}"}
        for name in ADDITIONAL_REFERENCES
    ]
    if manifest["versionFile"]["value"] != "22.0":
        raise SystemExit("Unexpected VERSION")
    return outputs, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "release/m10-research/里程碑列表复验-source/zentaopms-22.0")
    parser.add_argument("--write", action="store_true", help="Generate reference files from the pinned source")
    args = parser.parse_args()
    outputs, manifest = build(args.source)
    manifest_data = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    outputs["来源清单.json"] = manifest_data
    if args.write:
        for name, data in outputs.items():
            (DEST / name).write_bytes(data)
        print(f"Generated {len(outputs)} reference files from {COMMIT}")
    else:
        for name, expected in outputs.items():
            actual = (DEST / name).read_bytes()
            if actual != expected:
                raise SystemExit(f"Mismatch: {name}")
        print(f"PASS: {len(GROUPS)} excerpts, {len(LICENSES)} licenses, manifest and pinned HEAD; no network access")


if __name__ == "__main__":
    main()
