// Synthetic prototype choices only. Never discover or launch real applications.
export const PROTOTYPE_APPLICATIONS = [
  { id: 'textedit', name: 'TextEdit', path: '/prototype/apps/TextEdit.app', bundleId: 'prototype.textedit', systemDefault: true },
  { id: 'code', name: 'Visual Studio Code', path: '/prototype/apps/Code.app', bundleId: 'prototype.code', systemDefault: false },
];
export const MISSING_PROTOTYPE_APPLICATION = { path: '/prototype/apps/Missing Editor.app', bundleId: 'prototype.missing' };

export function prototypeApplicationChoices(preference) {
  const preferred = preference?.path
    ? PROTOTYPE_APPLICATIONS.find(app => app.path === preference.path && app.bundleId === preference.bundleId)
    : PROTOTYPE_APPLICATIONS.find(app => app.systemDefault);
  return { apps: PROTOTYPE_APPLICATIONS, preferred, preferredUnavailable: Boolean(preference?.path && !preferred) };
}

export function prototypeOpenApplication(preference, appId, remember, { available = true, missing = false } = {}) {
  const app = PROTOTYPE_APPLICATIONS.find(candidate => candidate.id === appId);
  if (!available || !app || missing) return { ok: false, preference, error: missing ? '文件不存在，原标签和内容已保留。' : '应用不可用，请重新选择打开方式。' };
  return { ok: true, app, preference: remember ? { path: app.path, bundleId: app.bundleId } : preference };
}

export function prototypeRevealTarget(rootPath, relativePath = '', { directory = false, missing = false } = {}) {
  if (missing) return { ok: false, error: '文件不存在，未打开文件管理器（模拟）。' };
  if (!rootPath || !rootPath.startsWith('/') || relativePath.startsWith('/') || relativePath.split('/').includes('..')) return { ok: false, error: '文件位置无效，未打开文件管理器（模拟）。' };
  const root = rootPath.replace(/\/+$/, '') || '/', path = relativePath ? `${root === '/' ? '' : root}/${relativePath}` : root;
  const slash = path.lastIndexOf('/');
  return { ok: true, path, parent: path.slice(0, slash) || '/', selected: path.slice(slash + 1) || '/', directory };
}
