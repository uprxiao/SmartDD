#!/usr/bin/env python3
"""Read-only closeout aggregation. Does not launch agents or access private config."""
import hashlib
import json
import struct
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[6]
BASE = ROOT / "docs/里程碑/M10_三方应用接入"
PROBES = Path(__file__).resolve().parent
PROTO = ROOT / "prototypes/m6-codex"
SNAP = PROTO / ".review/r16-closeout-20261019"
IMAGES = BASE / "原型/截图/R1.6-closeout-20261019"
OUT = BASE / "验收/证据/m10-development-readiness-20261019.json"


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def meta(p):
    return {"path": str(p.relative_to(ROOT)), "sha256": sha(p)}


def main():
    failures = []
    cc = json.loads((PROBES / "claude-user-config/result.json").read_text())
    codex = json.loads((PROBES / "codex-user-config/result.json").read_text())
    checks = json.loads((SNAP / "checks.json").read_text())
    ui = json.loads((IMAGES / "checks.json").read_text())
    if cc["assertionCount"] != 18 or not all(cc["assertions"].values()):
        failures.append("CC report assertion failure")
    if len(codex["cases"]) != 11 or any(c["status"] != "passed" for c in codex["cases"]):
        failures.append("Codex report case failure")
    if checks["m10Model"] != {"passed": 31, "failed": 0} or checks["existingPreviewModel"] != {"passed": 5, "failed": 0}:
        failures.append("Prototype model results differ from reviewed run")
    if checks["build"]["exitCode"] != 0:
        failures.append("Prototype build failure")
    old = json.loads((PROTO / ".review/r16-20261019/hashes.json").read_text())
    latest = {r["path"]: r["sha256"] for r in json.loads((SNAP / "final-hashes.json").read_text())}
    source_files = []
    for name, expected in {**old, **latest}.items():
        live = PROTO / name
        archived = (SNAP / "final" / name) if name in latest else (PROTO / ".review/r16-20261019/baseline" / name)
        if sha(live) != expected or sha(archived) != expected:
            failures.append("Prototype snapshot mismatch: " + name)
        source_files.append({**meta(live), "snapshot": str(archived.relative_to(ROOT))})
    images = []
    for p in sorted(IMAGES.glob("*.png")):
        raw = p.read_bytes()
        width, height = struct.unpack(">II", raw[16:24])
        ax = p.with_suffix(".txt")
        if not ax.exists():
            failures.append("Screenshot AX missing: " + p.name)
        images.append({**meta(p), "width": width, "height": height,
                       "capturedFileMtime": datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(),
                       "source": "Computer Use capture of local synthetic prototype",
                       "ax": meta(ax) if ax.exists() else None})
    product_diff = subprocess.run(["git", "diff", "--name-only", "--", "src", "resources", "native", "package.json", "electron-builder.config.cjs"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
    if product_diff:
        failures.append("Unexpected production changes require review: " + ", ".join(product_diff))
    pending_ui = [c["id"] for c in ui["cases"] if c["status"] != "passed"]
    evidence_files = []
    for sub in ["claude-user-config", "codex-user-config"]:
        evidence_files += sorted(p for p in (PROBES / sub).rglob("*") if p.is_file() and p.suffix in [".md", ".json", ".py", ".mjs"])
    evidence_files += [SNAP / "checks.json", SNAP / "final-hashes.json", SNAP / "model-tests.tap", SNAP / "build.log", IMAGES / "checks.json"]
    result = {
        "schema": "m10-development-readiness-closeout-v1",
        "at": datetime.now(timezone.utc).isoformat(),
        "requirements": "R1.6 / 12.1–12.21 / 2026-10-19",
        "branch": subprocess.run(["git", "branch", "--show-current"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip(),
        "baseCommit": subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip(),
        "worktree": "uncommitted design/prototype only; earlier changes preserved",
        "aggregationStatus": "failed" if failures else "passed",
        "designReadiness": "targeted-ui-pending" if pending_ui else "ready-for-development-review",
        "failures": failures,
        "results": {"ccAssertions": 18, "codexCases": 11, "includesNegativeNativeBehaviorEvidence": True,
                    "m10Model": 31, "existingPreviewModel": 5, "buildExitCode": checks["build"]["exitCode"],
                    "uiPassed": len(ui["cases"]) - len(pending_ui), "uiPending": pending_ui},
        "productAcceptance": "72 cases unchanged; preflight and synthetic UI do not count as product acceptance",
        "productionChanges": product_diff,
        "ui": ui,
        "prototypeFiles": source_files,
        "screenshots": images,
        "evidenceFiles": [meta(p) for p in evidence_files],
        "collector": meta(Path(__file__).resolve()),
        "limitations": ["Only current local macOS arm64 CC 2.1.303 / cdsh and Codex 0.162.1 probe configurations",
                        "No production launcher, broker, SQLite migration, real two-build upgrade or full visual matrix acceptance",
                        "Discovery preservation does not prove all user MCP servers healthy; user business tools not called",
                        "Real model probes use owned short native histories; user daily histories were not resumed",
                        "Hook execution and arbitrary profiles/config combinations remain outside evidence scope"]
    }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"aggregationStatus": result["aggregationStatus"], "designReadiness": result["designReadiness"], "results": result["results"], "screenshots": len(images), "failures": failures}, ensure_ascii=False))
    return bool(failures)


if __name__ == "__main__":
    raise SystemExit(main())
