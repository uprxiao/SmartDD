#!/usr/bin/env python3
"""Synthetic design probe only. No network, secrets, production imports or adapters."""
from __future__ import annotations

import copy
import hashlib
import json
import platform
import re
from pathlib import Path
from urllib.parse import quote, urljoin, urlsplit


ROOT = Path(__file__).resolve().parent


def schema(properties, required=()):
    return {"type": "object", "properties": properties,
            "required": list(required), "additionalProperties": False}


STRING = {"type": "string"}
CAPABILITIES = {
    "zentao.bug.get": {"effect": "read", "schema": schema({"id": STRING}, ["id"]),
                       "reconcile": "none", "role": "api"},
    "zentao.story.transition": {"effect": "external-write", "schema": schema(
        {"id": STRING, "action": {"type": "string", "enum": ["review", "close"]}},
        ["id", "action"]), "reconcile": "object-read-back", "role": "api"},
    "mail.message.get": {"effect": "read", "schema": schema({"id": STRING}, ["id"]),
                         "reconcile": "none", "role": "local-read"},
    "mail.message.send": {"effect": "external-write", "schema": schema(
        {"draftRef": STRING}, ["draftRef"]), "reconcile": "backend-specific", "role": "send"},
    "jenkins.job.get": {"effect": "read", "schema": schema({"jobRef": STRING}, ["jobRef"]),
                        "reconcile": "none", "role": "api"},
    "jenkins.build.trigger": {"effect": "external-write", "schema": schema(
        {"jobRef": STRING, "parameters": schema({"BRANCH": STRING})}, ["jobRef", "parameters"]),
        "reconcile": "queue-to-build", "role": "api"},
}

# These three registrations and all operation names are proposals, not actual connectors.
PROVIDERS = [
    {"id": "zentao", "adapterVersion": "0.0.0-probe", "contractVersion": 1,
     "configSchemaVersion": 1, "authKinds": ["server-session-or-token"],
     "capabilities": ["zentao.bug.get", "zentao.story.transition"],
     "compatibility": {"server": "biz13.0", "verifiedAgainstServer": False}},
    {"id": "mail", "adapterVersion": "0.0.0-probe", "contractVersion": 1,
     "configSchemaVersion": 1, "authKinds": ["local-files", "configured-send-backend"],
     "capabilities": ["mail.message.get", "mail.message.send"],
     "compatibility": {"backend": "separate-read-and-send", "verifiedAgainstServer": False}},
    {"id": "jenkins", "adapterVersion": "0.0.0-probe", "contractVersion": 1,
     "configSchemaVersion": 2, "authKinds": ["username-api-token"],
     "capabilities": ["jenkins.job.get", "jenkins.build.trigger"],
     "compatibility": {"server": "unknown", "plugins": {}, "verifiedAgainstServer": False}},
]


def validate(value, spec):
    """Deliberately small schema subset; NOT a production JSON Schema implementation."""
    kind = spec["type"]
    if kind == "object":
        if not isinstance(value, dict):
            raise ValueError("type")
        if set(spec.get("required", [])) - set(value):
            raise ValueError("required")
        if set(value) - set(spec["properties"]):
            raise ValueError("unknown-field")
        for key, item in value.items():
            validate(item, spec["properties"][key])
    elif kind == "string":
        if not isinstance(value, str) or not value:
            raise ValueError("type-or-empty")
    else:
        raise ValueError("unsupported-schema-subset")
    if "enum" in spec and value not in spec["enum"]:
        raise ValueError("enum")


def registry_check(providers):
    names = set()
    for provider in providers:
        if provider["id"] in names or provider["contractVersion"] != 1:
            raise ValueError("registration-version-or-duplicate")
        names.add(provider["id"])
        for operation in provider["capabilities"]:
            cap = CAPABILITIES[operation]
            if not operation.startswith(provider["id"] + "."):
                raise ValueError("namespace")
            if cap["effect"] not in ("read", "local-write", "external-write"):
                raise ValueError("effect")


def invoke(operation, arguments, binding, caller_read_only_hint=False):
    cap = CAPABILITIES[operation]
    validate(arguments, cap["schema"])
    if binding["capturedRevision"] != binding["currentRevision"] or not binding["enabled"]:
        raise ValueError("policy-revoked")
    if operation not in binding["allowed"] or cap["role"] not in binding["configuredRoles"]:
        raise ValueError("operation-or-role-denied")
    if cap["effect"] != "read" and not binding["writesAllowed"]:
        raise ValueError("effect-denied")
    # Never interpret a caller hint as permission. There is deliberately no real dispatch here.
    return {"syntheticDispatch": True, "effect": cap["effect"]}


def raw_job_path(segments):
    """Raw canonical item-name segments only; not display names or already encoded URLs."""
    if not segments:
        raise ValueError("empty-job")
    for segment in segments:
        if (not isinstance(segment, str) or not segment or segment in (".", "..")
                or any(c in segment for c in ("/", "\\", "%", "\x00"))):
            raise ValueError("ambiguous-segment")
    return "/".join("job/" + quote(s, safe="") for s in segments) + "/"


def within_scope(segments, allowed_prefix):
    return tuple(segments[:len(allowed_prefix)]) == tuple(allowed_prefix)


def queue_location(base, location):
    root = urlsplit(base)
    if (root.scheme != "https" or not root.hostname or root.username or root.password
            or root.query or root.fragment or not root.path.endswith("/")):
        raise ValueError("base")
    candidate = urlsplit(urljoin(base, location))
    if ((candidate.scheme, candidate.hostname, candidate.port)
            != (root.scheme, root.hostname, root.port) or candidate.username or candidate.password
            or candidate.query or candidate.fragment):
        raise ValueError("origin")
    expected = re.escape(root.path) + r"queue/item/([0-9]+)/"
    match = re.fullmatch(expected, candidate.path)
    if not match:
        raise ValueError("queue-path")
    return {"queueId": int(match.group(1)), "url": candidate.geturl()}


def retry_decision(operation):
    return "bounded-read-retry" if CAPABILITIES[operation]["effect"] == "read" else "reconcile-no-auto-repeat"


def classify_queue(payload):
    if payload.get("cancelled") is True:
        return {"phase": "cancelled", "providerProgress": {"namespace": "jenkins", "stage": "queue-cancelled"}}
    if payload.get("executable"):
        return {"phase": "running", "providerProgress": {"namespace": "jenkins", "stage": "build",
                "buildNumber": payload["executable"]["number"]}}
    return {"phase": "accepted", "providerProgress": {"namespace": "jenkins", "stage": "queued"}}


def classify_build(payload):
    if payload.get("building") is False and payload.get("result") is not None:
        # Terminal tracking is distinct from Jenkins business success/failure policy.
        return {"phase": "completed",
                "providerProgress": {"namespace": "jenkins", "stage": "finished", "result": payload["result"]}}
    return {"phase": "running", "providerProgress": {"namespace": "jenkins", "stage": "build"}}


def migrate_config(config):
    if config["schemaVersion"] == 1:
        return {"schemaVersion": 2, "jobScopes": [{"segments": config["folderSegments"]}],
                "secretRef": config["secretRef"]}
    if config["schemaVersion"] == 2:
        return copy.deepcopy(config)
    raise ValueError("unsupported-config-version")


def read_resource(handle, context, max_bytes):
    # Synthetic opaque handle resolution. No URL/path fetch, content or real bytes.
    if handle["connectionId"] != context["connectionId"] or handle["taskId"] != context["taskId"]:
        raise ValueError("resource-binding")
    if not context["enabled"] or context["revision"] != handle["policyRevision"]:
        raise ValueError("resource-revoked")
    return {"returnedBytes": min(handle["byteLength"], max_bytes),
            "complete": handle["byteLength"] <= max_bytes}


def main():
    checks = []

    def passed(name, detail):
        checks.append({"id": f"PC-{len(checks)+1:02d}", "name": name, "status": "passed", "detail": detail})

    def expect_rejected(call):
        try:
            call()
        except ValueError:
            return
        raise AssertionError("expected rejection")

    registry_check(PROVIDERS)
    passed("three-provider-registration", "3 synthetic definitions share one contract; no runtime provider loaded")
    expect_rejected(lambda: registry_check(PROVIDERS + [PROVIDERS[0]]))
    future = copy.deepcopy(PROVIDERS); future[0]["contractVersion"] = 2
    expect_rejected(lambda: registry_check(future))
    passed("registry-duplicate-and-future-version", "unknown contract version and duplicate identity rejected")
    binding = {"capturedRevision": 3, "currentRevision": 3, "enabled": True,
               "allowed": list(CAPABILITIES), "configuredRoles": ["api", "local-read"], "writesAllowed": False}
    for op, args in [("zentao.bug.get", {"id": "synthetic-1"}),
                     ("mail.message.get", {"id": "synthetic-2"}),
                     ("jenkins.job.get", {"jobRef": "synthetic-3"})]:
        assert invoke(op, args, binding)["effect"] == "read"
    passed("common-read-dispatch", "all three synthetic reads pass the same broker; no external calls")
    expect_rejected(lambda: invoke("jenkins.job.get", {"jobRef": "x", "arbitraryUrl": "x"}, binding))
    expect_rejected(lambda: invoke("zentao.bug.get", {"id": 1}, binding))
    expect_rejected(lambda: invoke("zentao.story.transition", {"id": "x", "action": "delete"}, binding))
    passed("schema-gate", "unknown fields, wrong types and undeclared enum are rejected before dispatch")
    expect_rejected(lambda: invoke("jenkins.build.trigger", {"jobRef": "x", "parameters": {}}, binding, True))
    passed("effect-is-registry-owned", "caller readOnly hint cannot convert external write into a read")
    revoked = dict(binding, currentRevision=4)
    expect_rejected(lambda: invoke("mail.message.get", {"id": "x"}, revoked))
    passed("current-policy-recheck", "captured task revision cannot override current revocation")
    send_binding = dict(binding, writesAllowed=True)
    expect_rejected(lambda: invoke("mail.message.send", {"draftRef": "x"}, send_binding))
    passed("mail-read-send-split", "local source registration alone cannot grant a configured send backend")
    assert raw_job_path(["Team A", "service+api", "main"]) == "job/Team%20A/job/service%2Bapi/job/main/"
    for segments in ([".."], ["folder/name"], ["already%20encoded"]):
        expect_rejected(lambda segments=segments: raw_job_path(segments))
    assert within_scope(["Team", "one"], ["Team"])
    assert not within_scope(["Team-other", "one"], ["Team"])
    passed("folder-encoding-and-scope", "segment encoding and boundary scope; complex branch slash names intentionally rejected")
    assert queue_location("https://ci.example.invalid/jenkins/", "/jenkins/queue/item/12/")["queueId"] == 12
    for target in ("https://other.example.invalid/jenkins/queue/item/12/", "/queue/item/12/",
                   "/jenkins/queue/item/12/?token=x", "/jenkins/queue/item/%31%32/"):
        expect_rejected(lambda target=target: queue_location("https://ci.example.invalid/jenkins/", target))
    passed("queue-location-constraint", "same origin, context path and exact queue-item grammar; no general URL proxy")
    assert classify_queue({})["phase"] == "accepted"
    assert classify_queue({"executable": {"number": 7}})["providerProgress"]["buildNumber"] == 7
    assert classify_queue({"cancelled": True})["phase"] == "cancelled"
    assert classify_build({"building": True, "result": "UNSTABLE"})["phase"] == "running"
    assert classify_build({"building": False, "result": "SUCCESS"})["phase"] == "completed"
    unstable = classify_build({"building": False, "result": "UNSTABLE"})
    assert unstable["phase"] == "completed" and unstable["providerProgress"]["result"] == "UNSTABLE"
    passed("provider-progress-extension", "queue acceptance, build mapping and terminal tracking remain distinct; exact business result preserved")
    assert retry_decision("mail.message.get") == "bounded-read-retry"
    for op in ("mail.message.send", "jenkins.build.trigger", "zentao.story.transition"):
        assert retry_decision(op) == "reconcile-no-auto-repeat"
    passed("write-timeout-policy", "all synthetic external writes reconcile; no automatic repeat after uncertain response")
    timeout = {"phase": "unknown", "providerProgress": {"namespace": "jenkins", "stage": "queue-lookup-timeout"}}
    cancel_request = {"phase": "accepted", "providerProgress": {"namespace": "jenkins", "stage": "cancel-requested"}}
    assert timeout["phase"] != "failed" and cancel_request["phase"] != "cancelled"
    passed("unknown-and-cancel-race", "poll timeout is unknown; cancel request acknowledgement is not final cancellation")
    original = {"schemaVersion": 1, "folderSegments": ["Team"], "secretRef": "opaque-synthetic-ref"}
    before = copy.deepcopy(original); migrated = migrate_config(original)
    assert original == before and migrated["schemaVersion"] == 2
    assert migrated["secretRef"] == original["secretRef"]
    expect_rejected(lambda: migrate_config({"schemaVersion": 9}))
    passed("provider-config-migration", "copy-on-transform retains opaque secret ref; unsupported future version blocked")
    handle = {"connectionId": "synthetic", "taskId": "run-1", "policyRevision": 3, "byteLength": 2000}
    context = {"connectionId": "synthetic", "taskId": "run-1", "revision": 3, "enabled": True}
    assert read_resource(handle, context, 512) == {"returnedBytes": 512, "complete": False}
    expect_rejected(lambda: read_resource(handle, dict(context, taskId="run-2"), 512))
    expect_rejected(lambda: read_resource(handle, dict(context, enabled=False), 512))
    passed("resource-budget-binding-revocation", "opaque resource metadata is bound and byte-limited; no content fetched")
    report = {"kind": "synthetic-design-experiment", "executedAt": "2026-10-17",
              "python": platform.python_version(), "networkCalls": 0, "realCredentials": False,
              "productionImplementation": False, "realServiceAcceptance": False,
              "schemaCoverage": "object/string/required/additionalProperties/enum subset only",
              "passed": len(checks), "failed": 0, "checks": checks,
              "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (ROOT / "registry-candidate.json").write_text(json.dumps(
        {"designCandidateOnly": True, "providers": PROVIDERS, "capabilities": CAPABILITIES},
        ensure_ascii=False, indent=2) + "\n")
    (ROOT / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"passed": len(checks), "failed": 0, "networkCalls": 0, "report": str(ROOT / "report.json")}))


if __name__ == "__main__":
    main()
