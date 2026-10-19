import type { FileSearchRequest, FileSearchResult } from '@shared/files';
import { rpcErrorMessage } from '@shared/ipc/rpc';

export interface SearchProtocolClient {
  startSearchSession?: (input: FileSearchRequest) => Promise<FileSearchResult>;
  search(input: FileSearchRequest): Promise<FileSearchResult>;
}
export interface SearchProtocolState { session: 'unknown' | 'supported' | 'unsupported' }

/** Only absence of this specific IPC procedure means an older search host.
 * Permission, timeout, native IO and query errors must remain visible errors. */
export function lacksSearchSession(error: unknown): boolean {
  return rpcErrorMessage(error) === "No handler registered for 'files.startSearchSession'";
}

export async function searchWithSessionFallback(
  api: SearchProtocolClient, request: FileSearchRequest, capability: SearchProtocolState,
  current: () => boolean,
): Promise<FileSearchResult | null> {
  if (!current()) return null;
  if (typeof api.startSearchSession !== 'function') capability.session = 'unsupported';
  if (capability.session !== 'unsupported') {
    try {
      const result = await api.startSearchSession!(request);
      if (current()) capability.session = 'supported';
      return current() ? result : null;
    } catch (error) {
      if (!current()) return null;
      if (!lacksSearchSession(error)) throw error;
      capability.session = 'unsupported';
    }
  }
  // A query cancelled while capability discovery was pending never launches a
  // replacement request. Both protocols use the same trusted root and ID.
  if (!current()) return null;
  // A legacy host has a strict pre-session schema. Keep that exact wire
  // contract; it cannot express priority hints and retains its own scan order.
  const legacy = { id: request.id, root: request.root, kind: request.kind, query: request.query, mask: request.mask };
  const result = await api.search(legacy);
  return current() ? result : null;
}
