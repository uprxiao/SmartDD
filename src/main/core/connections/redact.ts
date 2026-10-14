// Anything shown to the user or stored as a test message goes through here first.

const MIN_SECRET_LENGTH = 3;

const TOKEN_PATTERNS: RegExp[] = [
  /github_pat_[A-Za-z0-9_]+/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /xox[abpr]-[A-Za-z0-9-]+/g,
  /AKIA[0-9A-Z]{16}/g,
];

export function redact(text: string, secrets: (string | null | undefined)[] = []): string {
  let out = text;
  // Longest first so a secret that contains another is masked whole.
  const known = secrets
    .filter((s): s is string => typeof s === 'string' && s.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const s of known) out = out.split(s).join('***');
  for (const re of TOKEN_PATTERNS) out = out.replace(re, '***');
  // scheme://user:password@host
  out = out.replace(/(\w+:\/\/[^\s:/@]+:)[^\s@]+@/g, '$1***@');
  // password=..., pwd: ...  (but keep MySQL's "(using password: YES)")
  out = out.replace(
    /\b(password|passwd|pwd|secret|token)(\s*[=:]\s*)(?!(?:YES|NO)\b)("[^"]*"|'[^']*'|[^\s)]+)/gi,
    '$1$2***'
  );
  return out;
}
