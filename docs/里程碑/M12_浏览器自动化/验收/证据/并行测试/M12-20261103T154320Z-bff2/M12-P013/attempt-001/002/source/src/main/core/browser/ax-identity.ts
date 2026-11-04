import type { BrowserAXTree, BrowserAXNode } from './cdp-proxy';

export interface BrowserNodeIdentity {
  backendNodeId: number;
  frameId: string;
  sessionId?: string;
  role: string;
  name: string;
  ordinal: number;
}
export interface BrowserAXIndex {
  ordered: BrowserNodeIdentity[];
  groups: Map<string, BrowserNodeIdentity[]>;
}
export const browserAXRoleKey = (role: string, name: string): string => JSON.stringify([role, name]);
const groupKey = (node: Pick<BrowserNodeIdentity, 'sessionId' | 'frameId' | 'role' | 'name'>): string =>
  JSON.stringify([node.sessionId ?? '', node.frameId, node.role, node.name]);

/** CDP response array order is not document order. Follow childIds, preserving frame ownership. */
export function indexBrowserAXTrees(trees: readonly BrowserAXTree[]): BrowserAXIndex {
  const ordered: BrowserNodeIdentity[] = [], groups = new Map<string, BrowserNodeIdentity[]>(), identities = new Set<string>();
  for (const tree of trees) {
    const fallback = tree.frameId ?? tree.nodes.find(node => node.frameId)?.frameId;
    if (!fallback) continue;
    const byId = new Map(tree.nodes.map(node => [node.nodeId, node])), children = new Set(tree.nodes.flatMap(node => node.childIds ?? []));
    const visited = new Set<string>();
    const walk = (root: BrowserAXNode): void => {
      const stack = [{ node: root, frameId: fallback }];
      while (stack.length) {
        const item = stack.pop(); if (!item || visited.has(item.node.nodeId)) continue;
        const node = item.node, frameId = node.frameId ?? item.frameId;
        visited.add(node.nodeId);
        for (const id of [...(node.childIds ?? [])].reverse()) {
          const child = byId.get(id); if (child) stack.push({ node: child, frameId });
        }
        if (node.ignored || !node.backendDOMNodeId || !node.role?.value) continue;
        const identity = JSON.stringify([tree.sessionId ?? '', frameId, node.backendDOMNodeId]);
        if (identities.has(identity)) continue;
        identities.add(identity);
        const partial = { backendNodeId: node.backendDOMNodeId, frameId, sessionId: tree.sessionId, role: node.role.value, name: node.name?.value ?? '' };
        const key = groupKey(partial), group = groups.get(key) ?? [];
        const entry = { ...partial, ordinal: group.length };
        group.push(entry); groups.set(key, group); ordered.push(entry);
      }
    };
    for (const node of tree.nodes) if (!children.has(node.nodeId)) walk(node);
    for (const node of tree.nodes) walk(node);
  }
  return { ordered, groups };
}

/** Same semantic position must still denote the same browser node, not a name-equivalent replacement. */
export function browserAXIdentityMatches(index: BrowserAXIndex, expected: BrowserNodeIdentity): boolean {
  return index.groups.get(groupKey(expected))?.[expected.ordinal]?.backendNodeId === expected.backendNodeId;
}
