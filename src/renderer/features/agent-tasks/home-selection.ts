export type HomeSelection = { models: Record<string, string>; efforts: Record<string, string>; extensions: Record<string, boolean> };
/** 本地偏好是非可信缓存：旧配置、数组、超大值或坏 JSON 不能阻塞首页。 */
export function readHomeSelection(storage: Pick<Storage, 'getItem'>): HomeSelection {
  const empty = { models: {}, efforts: {}, extensions: {} };
  try {
    const text = storage.getItem('willyou-m14-home-selection');
    if (!text || text.length > 128 * 1024) return empty;
    const v = JSON.parse(text);
    const entries = (x: unknown) => x && typeof x === 'object' && !Array.isArray(x) ? Object.entries(x).slice(0, 200).filter(([k]) => /^[A-Za-z0-9_-]{1,128}$/.test(k)) : [];
    return {
      models: Object.fromEntries(entries(v?.models).filter(([, x]) => typeof x === 'string' && x.length <= 256 && !/[\x00-\x1f]/.test(x))),
      efforts: Object.fromEntries(entries(v?.efforts).filter(([, x]) => typeof x === 'string' && /^[a-z][a-z0-9_-]{0,23}$/.test(x))),
      extensions: Object.fromEntries(entries(v?.extensions).filter(([, x]) => typeof x === 'boolean')),
    };
  } catch { return empty; }
}
