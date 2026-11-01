import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAllowedOnboardingPath,
  onboardingViolations,
} from "./module-onboarding-rules.mjs";

const facts = (overrides = {}) => ({
  appId: "sample-kv",
  changedPaths: [
    "resources/applications/sample-kv/1.0.0/manifest.json",
    "src/shared/application-module-catalog.json",
    "src/main/core/applications/__tests__/sample-kv.test.ts",
    "docs/需求池.md",
  ],
  mentions: [{ path: "src/shared/application-module-catalog.json", count: 3 }],
  moduleBundle: true,
  catalogEntry: true,
  ...overrides,
});
test("accepts a data-only onboarding", () => {
  assert.deepEqual(onboardingViolations(facts()), []);
});
test("rejects a shared-code change and a branch on the application name", () => {
  const violations = onboardingViolations(
    facts({
      changedPaths: [
        ...facts().changedPaths,
        "src/main/core/applications/application-service.ts",
      ],
      mentions: [
        { path: "src/shared/application-module-catalog.json", count: 3 },
        { path: "src/main/core/applications/application-service.ts", count: 1 },
      ],
    }),
  );
  assert.deepEqual(
    violations.map((violation) => [violation.kind, violation.path]),
    [
      [
        "changed-protected-file",
        "src/main/core/applications/application-service.ts",
      ],
      [
        "app-name-in-protected-file",
        "src/main/core/applications/application-service.ts",
      ],
    ],
  );
});
test("rejects a renderer or preload reference even when that path is not changed in this commit", () => {
  const violations = onboardingViolations(
    facts({
      mentions: [
        { path: "src/renderer/src/views/capabilities.tsx", count: 2 },
        { path: "src/preload/index.ts", count: 1 },
      ],
    }),
  );
  assert.equal(violations.length, 2);
  assert.equal(violations[0].detail, "受保护文件出现应用名 2 处");
});
test("reports a missing bundle or catalog entry instead of passing quietly", () => {
  assert.deepEqual(
    onboardingViolations(
      facts({ moduleBundle: false, catalogEntry: false }),
    ).map((violation) => violation.kind),
    ["missing-module-bundle", "missing-catalog-entry"],
  );
});
test("keeps the allowlist narrow", () => {
  assert.equal(
    isAllowedOnboardingPath(
      "sample-kv",
      "resources/applications/sample-kv/1.0.0/manifest.json",
    ),
    true,
  );
  assert.equal(
    isAllowedOnboardingPath(
      "sample-kv",
      "src/main/core/applications/modules/sample-kv/index.ts",
    ),
    true,
  );
  assert.equal(
    isAllowedOnboardingPath(
      "sample-kv",
      "src/main/core/applications/modules/index.ts",
    ),
    true,
  );
  assert.equal(
    isAllowedOnboardingPath(
      "sample-kv",
      "src/main/core/applications/__tests__/sample-kv.test.ts",
    ),
    true,
  );
  assert.equal(
    isAllowedOnboardingPath(
      "sample-kv",
      "src/shared/application-module-catalog.json",
    ),
    true,
  );
  assert.equal(
    isAllowedOnboardingPath("sample-kv", "src/shared/applications.ts"),
    false,
  );
  assert.equal(
    isAllowedOnboardingPath(
      "sample-kv",
      "src/main/core/applications/modules/zentao/index.ts",
    ),
    false,
  );
  assert.equal(
    isAllowedOnboardingPath(
      "sample-kv",
      "src/main/core/applications/application-service.ts",
    ),
    false,
  );
  assert.equal(
    isAllowedOnboardingPath(
      "sample.kv",
      "resources/applications/sampleXkv/1.0.0/manifest.json",
    ),
    false,
  );
});
