// Local presentation budget. Native enumeration and fuzzy scoring remain full.
export const NAME_RESULT_LIMIT = 5000;
export function limitNameResults(ranked, limit = NAME_RESULT_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200000) throw Error('Invalid name result limit');
  return { ranked: ranked.slice(0, limit), total: ranked.length, truncated: ranked.length > limit, limit };
}
export function nameResultNotice(result) {
  return result?.truncated ? `名称结果仅显示前 ${result.limit} 项（共 ${result.total} 项）。请缩小关键词查看其余匹配。` : '';
}
