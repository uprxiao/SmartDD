// A user-facing source link is a host input, never a decoder/protocol URL.
export function mediaCopyLink(sourceUrl) {
  if (typeof sourceUrl !== 'string' || !sourceUrl) return null;
  try {
    const url = new URL(sourceUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? sourceUrl : null;
  } catch { return null; }
}
