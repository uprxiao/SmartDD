export const FILE_SEARCH_INPUT_LIMIT = 256;
export const isWellFormedSearchText = value => typeof value === 'string' && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
// The HTML maxlength boundary uses UTF-16 units. Retain only whole code points.
export function clampFileSearchInput(value) {
  const limited = value.slice(0, FILE_SEARCH_INPUT_LIMIT);
  return /[\uD800-\uDBFF]$/u.test(limited) ? limited.slice(0, -1) : limited;
}
