/**
 * Original implementation from the behavioral specification in M9 research §11.
 * No shipped Codex source, private resource, or third-party matcher is bundled.
 * This ranks an already supplied (prototype/mock) candidate set. It does not
 * reproduce native filesystem traversal, nucleo scoring, or candidate limits.
 * Offsets and length penalties use JavaScript UTF-16 code units.
 */
export const FILE_FUZZY_REVISION = 'M9-R1a-20261017';

const letterOrDigit = value => /^[a-z0-9]$/i.test(value || '');
const digit = value => value >= '0' && value <= '9';
const upper = value => value.toUpperCase() === value && value.toLowerCase() !== value;
const lower = value => value.toLowerCase() === value && value.toUpperCase() !== value;
const wildcard = value => value === '*' || value === ' ';
const separator = value => value != null && (!value.trim() || '_-:+./\\'.includes(value));
const equalIgnoringCase = (pattern, value) => value === pattern ||
  value === pattern.toLowerCase() || value === pattern.toUpperCase();

function wordStart(name, offset) {
  if (offset < 0 || offset >= name.length || !letterOrDigit(name[offset])) return false;
  if (offset === 0) return true;
  const before = name[offset - 1], current = name[offset];
  return !letterOrDigit(before) || (upper(current) && lower(before)) || (digit(current) && !digit(before));
}

function nextBoundary(name, offset) {
  if (offset < name.length && digit(name[offset])) return offset + 1;
  for (let next = offset + 1; next < name.length; next++) if (wordStart(name, next)) return next;
  return name.length + 1;
}

function prepare(query) {
  const trimmed = String(query ?? '').trim();
  // A lowercasing operation that expands a code point must not shift offsets.
  const folded = Array.from(trimmed, char => {
    const result = char.toLowerCase();
    return result.length === char.length ? result : char;
  }).join('');
  const pathQuery = /[/\\]/.test(folded);
  let suffixOffset = -1;
  for (const slash of ['/', '\\']) {
    const last = folded.lastIndexOf(slash);
    if (last >= 0 && last < folded.length - 1) suffixOffset = Math.max(suffixOffset, last);
  }
  const suffix = folded.slice(suffixOffset + 1);
  return {
    empty: !trimmed,
    pathQuery,
    primary: '*' + (pathQuery ? folded.replace(/[/\\]/g, '*\0*') : folded),
    secondary: pathQuery && suffix !== folded ? suffix : null
  };
}

function joinedFragments(start, length, rest) {
  const first = { start, end: start + length };
  return rest.length && rest[0].start === first.end
    ? [{ start, end: rest[0].end }, ...rest.slice(1)] : [first, ...rest];
}

/** Recognize the fragment grammar; this is not edit-distance matching. */
function findFragments(name, compiled) {
  const pattern = compiled.split('');
  const literal = pattern.filter(char => !wildcard(char));
  if (name.length < literal.length) return null;
  if (pattern.length > 100) {
    const needle = compiled.replaceAll('*', '');
    if (name.length < needle.length) return null;
    const at = compiled.startsWith('*') ? name.toLowerCase().indexOf(needle.toLowerCase()) :
      (name.slice(0, needle.length).toLowerCase() === needle.toLowerCase() ? 0 : -1);
    return at >= 0 && at + needle.length <= name.length ? [{ start: at, end: at + needle.length }] : null;
  }
  // Reject impossible subsequences before the bounded fragment search. The last
  // alphanumeric pattern character must either follow its predecessor or begin
  // a word; an arbitrary final character in the middle of a word is not enough.
  let consumed = 0;
  for (let index = 0; index < name.length && consumed < literal.length; index++) {
    if (!equalIgnoringCase(literal[consumed], name[index])) continue;
    const previous = pattern.length - 2;
    const final = consumed === literal.length - 1;
    if (final && previous >= 0 && letterOrDigit(pattern[previous + 1]) && !wildcard(pattern[previous]) &&
      (index === 0 || !equalIgnoringCase(pattern[previous], name[index - 1])) && !wordStart(name, index)) continue;
    consumed++;
  }
  if (consumed !== literal.length) return null;

  const failures = new Set();
  const hasDot = compiled.includes('.');
  const mixedCase = pattern.some(lower) && pattern.some((char, index) => upper(char) && pattern.slice(0, index).some(c => !wildcard(c)));
  const locate = (patternAt, from) => {
    const mustStartWord = pattern[patternAt - 1] !== '*' && !separator(pattern[patternAt]);
    if (mustStartWord && mixedCase && lower(pattern[patternAt]) && !(patternAt > 0 && separator(pattern[patternAt - 1]))) return -1;
    for (let index = from; index < name.length; index++) {
      if (!equalIgnoringCase(pattern[patternAt], name[index])) continue;
      if (!mustStartWord || !letterOrDigit(pattern[patternAt]) || wordStart(name, index)) return index;
    }
    return -1;
  };
  const mayCross = (patternAt, from, to) => to >= 0 &&
    !(hasDot && pattern[patternAt - 1] !== '.' && name.slice(from, to).includes('.'));
  const interior = (patternAt, nameAt) => pattern[patternAt - 1] === '*' &&
    !wildcard(pattern[patternAt + 1]) && letterOrDigit(name[nameAt]) && !wordStart(name, nameAt);

  function runLength(patternAt, nameAt) {
    if (nameAt >= name.length || !equalIgnoringCase(pattern[patternAt], name[nameAt])) return 0;
    let count = 1;
    while (nameAt + count < name.length && patternAt + count < pattern.length) {
      if (!equalIgnoringCase(pattern[patternAt + count], name[nameAt + count])) {
        if (digit(pattern[patternAt + count]) && digit(pattern[patternAt + count - 1]) && digit(name[nameAt + count])) return 0;
        break;
      }
      count++;
    }
    return count;
  }

  function continueFragment(patternAt, nameAt, length) {
    const minimum = interior(patternAt, nameAt) ? 3 : 1;
    // Relevant for Unicode uppercase characters retained by length-safe folding;
    // ordinary ASCII queries have already been folded to lowercase.
    for (let cut = minimum; cut < length; cut++) {
      const char = pattern[patternAt + cut];
      if (!upper(char) || char === name[nameAt + cut]) continue;
      let next = -1;
      for (let index = nameAt + cut; index < name.length; index++) {
        if (equalIgnoringCase(char, name[index]) && (!letterOrDigit(char) || wordStart(name, index))) { next = index; break; }
      }
      const tail = visit(patternAt + cut, next);
      if (tail !== null) return joinedFragments(nameAt, cut, tail);
    }
    if (patternAt + length >= pattern.length) return [{ start: nameAt, end: nameAt + length }];
    for (let take = length; take >= minimum || (take > 0 && wildcard(pattern[patternAt + take])); take--) {
      let tail = null;
      if (wildcard(pattern[patternAt + take])) tail = visit(patternAt + take, nameAt + take);
      else {
        const next = locate(patternAt + take, nameAt + take + 1);
        if (mayCross(patternAt + take, nameAt + take, next)) tail = scan(patternAt + take, next, false);
      }
      if (tail !== null) return joinedFragments(nameAt, take, tail);
    }
    return null;
  }

  function scan(patternAt, from, unrestrictedGap) {
    if (from < 0) return null;
    const key = `${patternAt}:${from}:${Number(unrestrictedGap)}`;
    if (failures.has(key)) return null;
    let bestRun = 0;
    for (let at = from; at >= 0;) {
      const eligible = !upper(pattern[patternAt]) || upper(name[at]) || wordStart(name, at) || !mixedCase;
      const length = eligible ? runLength(patternAt, at) : 0;
      if (length > bestRun) {
        if (!interior(patternAt, at)) bestRun = length;
        const found = continueFragment(patternAt, at, length);
        if (found !== null) return found;
      }
      const next = locate(patternAt, at + 1);
      at = unrestrictedGap || mayCross(patternAt, at + 1, next) ? next : -1;
    }
    failures.add(key);
    return null;
  }

  function visit(patternAt, nameAt) {
    if (nameAt < 0) return null;
    if (wildcard(pattern[patternAt])) {
      while (wildcard(pattern[patternAt])) patternAt++;
      return patternAt === pattern.length ? [] : scan(patternAt, locate(patternAt, nameAt), true);
    }
    if (patternAt === pattern.length) return [];
    const length = runLength(patternAt, nameAt);
    return length ? continueFragment(patternAt, nameAt, length) : null;
  }
  return visit(0, 0);
}

function degree(name, compiled, fragments) {
  if (!fragments.length) return 0;
  const pattern = compiled.split('');
  let contribution = 0, patternAt = -1, boundary = 0, skipped = 0, uppercaseRun = false;
  for (let fragmentIndex = 0; fragmentIndex < fragments.length; fragmentIndex++) {
    const fragment = fragments[fragmentIndex];
    for (let index = fragment.start; index < fragment.end; index++) {
      const startsLaterFragment = fragmentIndex > 0 && index === fragment.start;
      let atBoundary = false;
      while (boundary <= index) {
        if (boundary === index) atBoundary = true;
        else if (startsLaterFragment) skipped++;
        boundary = nextBoundary(name, boundary);
      }
      const char = name[index];
      do { patternAt++; } while (patternAt < pattern.length &&
        pattern[patternAt] !== char.toLowerCase() && pattern[patternAt] !== char.toUpperCase());
      if (patternAt === pattern.length) break;
      const target = pattern[patternAt];
      if (atBoundary) uppercaseRun = char === target && upper(target);
      if (startsLaterFragment && atBoundary && lower(target)) contribution -= 10;
      else if (char === target) contribution += upper(target) ? 50 : Number(atBoundary);
      else if (atBoundary || (lower(target) && uppercaseRun)) contribution--;
    }
  }
  const start = fragments[0].start;
  return 1000 * Number(start === 0 || (wordStart(name, start) && !wordStart(name, start - 1))) +
    contribution - fragments.length - 10 * skipped +
    2 * Number(!/[/\\]/.test(name.slice(0, start))) + Number(start === 0) +
    Number(fragments.at(-1).end === name.length);
}

function evaluate(prepared, fileName) {
  if (prepared.empty) return { score: 0, indices: [], fragments: [], matched: false, matchMode: 'empty' };
  const normalizedName = prepared.pathQuery ? fileName.replace(/[/\\]/g, '\0') : fileName;
  for (const [mode, pattern] of [['primary', prepared.primary], ['path-basename-fallback', prepared.secondary]]) {
    if (pattern === null) continue;
    const fragments = findFragments(normalizedName, pattern);
    if (fragments === null) continue;
    const prefix = fragments.length && fragments[0].start === 0 ? 10000 : 0;
    return {
      score: Math.max(1, 10 * (degree(normalizedName, pattern, fragments) + prefix) - fileName.length),
      indices: fragments.flatMap(({ start, end }) => Array.from({ length: end - start }, (_, offset) => start + offset)),
      fragments,
      matched: true,
      matchMode: mode,
      longPattern: pattern.length > 100
    };
  }
  return { score: 0, indices: [], fragments: [], matched: false, matchMode: 'none' };
}

export function scoreFileName(query, fileName) {
  return evaluate(prepare(query), String(fileName ?? ''));
}

/**
 * Keep every supplied candidate, including zero scores. Caller owns exclusion
 * rules and native/mock candidate generation. Returned indices describe this
 * independent basename matcher, NOT the discarded native path-match indices.
 * A missing file_name is derived from the final slash/backslash path component.
 */
export function rankFileCandidates(query, candidates) {
  const prepared = prepare(query);
  const ranked = candidates.map((candidate, index) => {
    const file_name = String(candidate.file_name ?? candidate.label ?? String(candidate.path ?? '').split(/[/\\]/).at(-1));
    return { candidate, file_name, index, result: evaluate(prepared, file_name) };
  });
  if (!prepared.empty) ranked.sort((left, right) => right.result.score - left.result.score ||
    (left.file_name < right.file_name ? -1 : left.file_name > right.file_name ? 1 : 0) || left.index - right.index);
  return ranked.map(({ candidate, file_name, result }) => ({ ...candidate, file_name, ...result }));
}
