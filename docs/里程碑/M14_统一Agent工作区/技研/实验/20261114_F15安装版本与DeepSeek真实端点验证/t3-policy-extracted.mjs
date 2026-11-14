const SEMVER_NUMBER_SEGMENT = /^\d+$/;
function normalizeSemverVersion(version) {
  const [versionWithoutBuildMetadata = ""] = version.trim().split("+", 1);
  const [main, ...prereleaseParts] = versionWithoutBuildMetadata.split("-");
  const prerelease = prereleaseParts.join("-");
  const segments = [];
  for (const segment of (main ?? "").split(".")) {
    const trimmed = segment.trim();
    if (trimmed.length > 0) {
      segments.push(trimmed);
    }
  }
  while (segments.length > 0 && segments.length < 3) {
    segments.push("0");
  }
  return prerelease ? `${segments.join(".")}-${prerelease}` : segments.join(".");
}
function parseSemver(value) {
  const normalized = normalizeSemverVersion(value).replace(/^v/, "");
  const [main = "", ...prereleaseParts] = normalized.split("-");
  const prerelease = prereleaseParts.join("-");
  const segments = main.split(".");
  if (segments.length !== 3) {
    return null;
  }
  const [majorSegment, minorSegment, patchSegment] = segments;
  if (majorSegment === void 0 || minorSegment === void 0 || patchSegment === void 0) {
    return null;
  }
  if (!SEMVER_NUMBER_SEGMENT.test(majorSegment) || !SEMVER_NUMBER_SEGMENT.test(minorSegment) || !SEMVER_NUMBER_SEGMENT.test(patchSegment)) {
    return null;
  }
  const major = Number.parseInt(majorSegment, 10);
  const minor = Number.parseInt(minorSegment, 10);
  const patch = Number.parseInt(patchSegment, 10);
  if (![major, minor, patch].every(Number.isInteger)) {
    return null;
  }
  return {
    major,
    minor,
    patch,
    prerelease: parsePrereleaseSegments(prerelease)
  };
}
function parsePrereleaseSegments(prerelease) {
  if (prerelease === void 0) {
    return [];
  }
  const segments = [];
  for (const segment of prerelease.split(".")) {
    const trimmed = segment.trim();
    if (trimmed.length > 0) {
      segments.push(trimmed);
    }
  }
  return segments;
}
function comparePrereleaseIdentifier(left, right) {
  const leftNumeric = SEMVER_NUMBER_SEGMENT.test(left);
  const rightNumeric = SEMVER_NUMBER_SEGMENT.test(right);
  if (leftNumeric && rightNumeric) {
    return Number.parseInt(left, 10) - Number.parseInt(right, 10);
  }
  if (leftNumeric) {
    return -1;
  }
  if (rightNumeric) {
    return 1;
  }
  return left.localeCompare(right);
}
function compareSemverVersions(left, right) {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  if (!parsedLeft || !parsedRight) {
    return left.localeCompare(right);
  }
  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major - parsedRight.major;
  }
  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor - parsedRight.minor;
  }
  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch - parsedRight.patch;
  }
  if (parsedLeft.prerelease.length === 0 && parsedRight.prerelease.length === 0) {
    return 0;
  }
  if (parsedLeft.prerelease.length === 0) {
    return 1;
  }
  if (parsedRight.prerelease.length === 0) {
    return -1;
  }
  const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = parsedLeft.prerelease[index];
    const rightIdentifier = parsedRight.prerelease[index];
    if (leftIdentifier === void 0) {
      return -1;
    }
    if (rightIdentifier === void 0) {
      return 1;
    }
    const comparison = comparePrereleaseIdentifier(leftIdentifier, rightIdentifier);
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}
const satisfiesSemverRange = function satisfiesSemverRange2(rawVersion, range) {
  const normalizedVersion = String(rawVersion).trim().replace(/^v/, "");
  const versionMatch = normalizedVersion.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?$/
  );
  if (!versionMatch) {
    return false;
  }
  const version = {
    major: Number(versionMatch[1]),
    minor: Number(versionMatch[2] || 0),
    patch: Number(versionMatch[3] || 0)
  };
  return range.split("||").some((group) => {
    const comparators = group.trim().replace(/(\^|>=|>|<=|<|=)\s+(?=v?\d)/g, "$1").split(/\s+/).filter(Boolean);
    if (comparators.length === 0) {
      return false;
    }
    return comparators.every((comparator) => {
      const match = comparator.trim().match(/^(\^|>=|>|<=|<|=)?\s*v?(\d+(?:\.\d+){0,2})$/);
      if (!match) {
        return false;
      }
      const targetVersion = match[2];
      if (targetVersion === void 0) {
        return false;
      }
      const targetMatch = targetVersion.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
      if (!targetMatch) {
        return false;
      }
      const target = {
        major: Number(targetMatch[1]),
        minor: Number(targetMatch[2] || 0),
        patch: Number(targetMatch[3] || 0)
      };
      const compared = version.major !== target.major ? version.major > target.major ? 1 : -1 : version.minor !== target.minor ? version.minor > target.minor ? 1 : -1 : version.patch !== target.patch ? version.patch > target.patch ? 1 : -1 : 0;
      const operator = match[1] || "=";
      switch (operator) {
        case "^":
          if (compared < 0) {
            return false;
          }
          if (target.major > 0 || targetMatch[2] === void 0) {
            return version.major === target.major;
          }
          if (target.minor > 0 || targetMatch[3] === void 0) {
            return version.major === 0 && version.minor === target.minor;
          }
          return version.major === 0 && version.minor === 0 && version.patch === target.patch;
        case ">=":
          return compared >= 0;
        case ">":
          return compared > 0;
        case "<=":
          return compared <= 0;
        case "<":
          return compared < 0;
        case "=":
          return compared === 0;
        default:
          return false;
      }
    });
  });
};
const packageJson = { "version": "0.1.9" };
function resolveProviderCompatibility(policies, driver, version, t3CodeVersion = packageJson.version) {
  const policy = policies?.find(
    (entry) => entry.driver === driver && satisfiesSemverRange(t3CodeVersion, entry.t3CodeRange)
  );
  if (!policy) return void 0;
  const unprefixed = version?.replace(/^v/, "");
  const stable = driver === "cursor" ? unprefixed?.replace(/^(\d{4}\.\d{2}\.\d{2})-[a-f0-9]+$/, "$1") : driver === "antigravity" ? unprefixed?.replace(/^agy_acp_server_(\d+\.\d+\.\d+)$/, "$1") : driver === "muse" ? unprefixed?.replace(/^(\d+\.\d+\.\d+)-R\d+(?:\.\d+)?$/, "$1") : unprefixed;
  const status = stable && /^\d+\.\d+\.\d+$/.test(stable) ? policy.ranges.find((entry) => satisfiesSemverRange(stable, entry.range))?.status ?? "unknown" : "unknown";
  const message = status === "broken" ? "This provider version is known to be incompatible with this T3 Code release." : status === "unsupported" ? "This provider version is outside the supported range for this T3 Code release." : status === "graceful" ? "This provider version has limited compatibility with this T3 Code release." : null;
  const recommendedVersion = policy.recommendedVersion ?? null;
  const recommendedRange = policy.recommendedRange ?? null;
  const recommendation = recommendedVersion ?? recommendedRange;
  return {
    status,
    message: message && recommendation ? `${message} Use ${recommendation}.` : message,
    recommendedVersion,
    recommendedRange
  };
}
export {
  compareSemverVersions,
  normalizeSemverVersion,
  parseSemver,
  resolveProviderCompatibility,
  satisfiesSemverRange
};
