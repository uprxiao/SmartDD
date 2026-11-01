// Declarative onboarding boundary for application modules, kept as plain JS so the CLI check and
// its unit test share one implementation.
// Adding an application is meant to be data-only: a bundle under resources/applications/<appId>/
// plus one entry in the declared catalog. A branch in shared main, renderer or preload code means
// the platform is not generic yet, so it is reported instead of landing silently.
const PROTECTED = [
  /^src\/main\//,
  /^src\/renderer\//,
  /^src\/shared\//,
  /^src\/preload\//,
];
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const allowed = (appId) => [
  new RegExp(`^resources/applications/${escape(appId)}/`),
  new RegExp(`^src/main/core/applications/modules/${escape(appId)}/`),
  /^src\/main\/core\/applications\/modules\/index\.ts$/,
  /^src\/main\/core\/applications\/__tests__\//,
  /^src\/shared\/application-module-catalog\.json$/,
  /^docs\//,
  /^scripts\/applications\//,
  /^resources\/application-upstreams\//,
];
export const isProtected = (path) =>
  PROTECTED.some((pattern) => pattern.test(path));
export const isAllowedOnboardingPath = (appId, path) =>
  allowed(appId).some((pattern) => pattern.test(path));
export function onboardingViolations({
  appId,
  changedPaths = [],
  mentions = [],
  moduleBundle = true,
  catalogEntry = true,
}) {
  const violations = [];
  if (!moduleBundle)
    violations.push({
      kind: "missing-module-bundle",
      path: `resources/applications/${appId}/`,
      detail: "模块包缺失",
    });
  if (!catalogEntry)
    violations.push({
      kind: "missing-catalog-entry",
      path: "src/shared/application-module-catalog.json",
      detail: "目录条目缺失",
    });
  for (const path of changedPaths)
    if (isProtected(path) && !isAllowedOnboardingPath(appId, path))
      violations.push({
        kind: "changed-protected-file",
        path,
        detail: "受保护文件被修改",
      });
  for (const mention of mentions)
    if (
      isProtected(mention.path) &&
      !isAllowedOnboardingPath(appId, mention.path)
    )
      violations.push({
        kind: "app-name-in-protected-file",
        path: mention.path,
        detail: `受保护文件出现应用名 ${mention.count} 处`,
      });
  return violations;
}
