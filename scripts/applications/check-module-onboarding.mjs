#!/usr/bin/env node
// Verifies that a newly registered application is data-only: its module bundle and one declarative
// catalog entry, with no branch on the application name in shared main, renderer or preload code.
// Usage: node scripts/applications/check-module-onboarding.mjs --app sample-kv [--base origin/main] [--json]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { onboardingViolations } from "./module-onboarding-rules.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const appId = option("app");
const base = option("base");
const asJson = args.includes("--json");
if (!appId) {
  console.error("Specify --app <appId>");
  process.exit(2);
}
const git = (...params) =>
  execFileSync("git", params, { cwd: repo, encoding: "utf8" }).trim();
const catalog = (() => {
  try {
    return JSON.parse(
      readFileSync(
        join(repo, "src/shared/application-module-catalog.json"),
        "utf8",
      ),
    );
  } catch (error) {
    console.error("Cannot read the application catalog: " + String(error));
    process.exit(2);
  }
})();
const entry = catalog.applications?.find(
  (application) => application.appId === appId,
);
const moduleDir = join(repo, "resources/applications", appId);
const fallbackUpstream = join(
  repo,
  "resources/application-upstreams",
  `${appId}.cjs`,
);
const moduleBundle = existsSync(moduleDir) || existsSync(fallbackUpstream);
const changedPaths = base
  ? git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean)
  : [];
const protectedFiles = git(
  "ls-files",
  "src/main",
  "src/renderer",
  "src/shared",
  "src/preload",
)
  .split("\n")
  .filter(Boolean);
const mentions = protectedFiles
  .filter((path) => !path.endsWith(".snap"))
  .map((path) => {
    try {
      const text = readFileSync(join(repo, path), "utf8");
      return { path, count: text.split(appId).length - 1 };
    } catch {
      return { path, count: 0 };
    }
  })
  .filter((mention) => mention.count > 0);
const violations = onboardingViolations({
  appId,
  changedPaths,
  mentions,
  moduleBundle,
  catalogEntry: Boolean(entry),
});
const report = {
  schema: "willyou-module-onboarding-check-v1",
  appId,
  base: base ?? null,
  commit: git("rev-parse", "HEAD"),
  moduleBundle,
  catalogEntry: Boolean(entry),
  catalogCapabilities:
    entry?.capabilities?.map((capability) => capability.id) ?? [],
  changedPaths,
  mentions,
  violations,
  status: violations.length === 0 ? "passed" : "failed",
};
if (asJson) console.log(JSON.stringify(report, null, 2));
else {
  console.log(
    `${report.status.toUpperCase()} ${appId} @ ${report.commit.slice(0, 8)}`,
  );
  console.log(
    `  模块包 ${moduleBundle ? "存在" : "缺失"} · 目录条目 ${report.catalogEntry ? "存在" : "缺失"}` +
      `${base ? ` · 受保护文件改动 ${changedPaths.filter((path) => /^src\/(main|renderer|shared|preload)\//.test(path)).length} 个` : " · 未指定 --base，跳过改动检查"}`,
  );
  for (const violation of violations)
    console.error(
      `  [${violation.kind}] ${violation.path} — ${violation.detail}`,
    );
}
process.exitCode = violations.length === 0 ? 0 : 1;
