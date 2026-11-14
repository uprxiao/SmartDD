// packages/shared/src/orchestrationV2Timeline.ts
function isOrchestrationV2SupersededInterrupt(input) {
  const { item } = input;
  if (item.type !== "run_interrupt_result" || item.runId === null || item.nodeId === null) {
    return false;
  }
  const isSuperseded = input.attempts.some(
    (attempt) => attempt.runId === item.runId && attempt.rootNodeId === item.nodeId && attempt.status === "superseded"
  );
  if (!isSuperseded) {
    return false;
  }
  const hasMatchingRequest = input.items.some(
    (candidate) => candidate.type === "run_interrupt_request" && candidate.runId === item.runId
  );
  return !hasMatchingRequest;
}
function isOrchestrationV2TurnItemVisible(input) {
  const { item } = input;
  if (item.runId !== null && input.runs.some((run) => run.id === item.runId && run.status === "rolled_back")) {
    return false;
  }
  if (item.type === "user_message" && item.inputIntent === "queued_turn" && item.runId !== null && input.runs.some(
    (run) => run.id === item.runId && (run.status === "queued" || run.status === "cancelled")
  )) {
    return false;
  }
  return !isOrchestrationV2SupersededInterrupt({
    item,
    attempts: input.attempts,
    items: input.items
  });
}

// packages/client-runtime/src/state/threadHistoryMerge.ts
var EMPTY_THREAD_HISTORY_META = {
  historyCursor: null,
  hasMoreHistory: false,
  loading: false,
  error: null,
  expanded: false,
  latestLocalTurnOrdinal: null
};
function isActiveHistoryRequestCursor(requestCursor, history) {
  return history.historyCursor === requestCursor;
}
function clearActiveHistoryLoading(requestCursor, history) {
  if (!isActiveHistoryRequestCursor(requestCursor, history) || !history.loading) {
    return history;
  }
  return { ...history, loading: false };
}
function projectedItemKey(row) {
  return `${row.sourceThreadId}:${row.sourceItemId}`;
}
function renumberVisible(rows) {
  return rows.map((row, position) => row.position === position ? row : { ...row, position });
}
function mergeOlderHistoryIntoProjection(projection, olderItems, work) {
  if (olderItems.length === 0 && work === void 0) {
    return projection;
  }
  const start = work === void 0 ? -1 : projection.visibleTurnItems.findIndex((row) => row.sourceItemId === work.anchorId);
  const anchor = projection.visibleTurnItems[start];
  const deferred = anchor?.item.deferredWork;
  if (work !== void 0 && deferred === void 0) return projection;
  const currentByKey = new Map(
    projection.visibleTurnItems.map((row) => [projectedItemKey(row), row])
  );
  const turnItemById = new Map(projection.turnItems.map((item) => [String(item.id), item]));
  const pageKeys = /* @__PURE__ */ new Set();
  const page = [];
  for (const pageRow of olderItems) {
    if (work && anchor && deferred && (pageRow.sourceThreadId !== anchor.sourceThreadId || pageRow.item.ordinal < anchor.item.ordinal || pageRow.item.ordinal > deferred.lastOrdinal))
      continue;
    const key = projectedItemKey(pageRow);
    if (pageKeys.has(key)) continue;
    let row = currentByKey.get(key) ?? pageRow;
    if (!currentByKey.has(key) && (row.visibility === "local" || row.sourceThreadId === projection.thread.id)) {
      const currentItem = turnItemById.get(String(row.sourceItemId));
      if (currentItem !== void 0) {
        if (currentItem.type !== "run_interrupt_request" && currentItem.type !== "approval_request" && currentItem.type !== "user_input_request" || !isOrchestrationV2TurnItemVisible({
          item: currentItem,
          runs: projection.runs,
          attempts: projection.attempts,
          items: projection.turnItems
        }))
          continue;
        row = { ...row, item: currentItem };
      }
    }
    pageKeys.add(key);
    page.push(row);
    if ((row.visibility === "local" || row.sourceThreadId === projection.thread.id) && !turnItemById.has(String(row.sourceItemId)))
      turnItemById.set(String(row.sourceItemId), row.item);
  }
  if (page.length === 0 && work === void 0) return projection;
  let visible;
  if (work && anchor && deferred) {
    let end = start + 1;
    while (end < projection.visibleTurnItems.length) {
      const row = projection.visibleTurnItems[end];
      if (row.sourceThreadId !== anchor.sourceThreadId || row.visibility === "synthetic" || row.item.ordinal > deferred.lastOrdinal)
        break;
      end += 1;
    }
    const item = { ...anchor.item };
    if (work.nextCursor === null) delete item.deferredWork;
    else item.deferredWork = { ...deferred, cursor: work.nextCursor };
    const updated = { ...anchor, item };
    const section = [
      ...page,
      ...projection.visibleTurnItems.slice(start, end).filter((row) => !pageKeys.has(projectedItemKey(row)))
    ];
    const ordered = section.map((row) => row.sourceItemId === anchor.sourceItemId ? updated : row).sort((left, right) => left.item.ordinal - right.item.ordinal);
    visible = [
      ...projection.visibleTurnItems.slice(0, start),
      ...ordered,
      ...projection.visibleTurnItems.slice(end)
    ];
    if (anchor.visibility === "local") turnItemById.set(String(updated.item.id), updated.item);
  } else {
    visible = [
      ...page,
      ...projection.visibleTurnItems.filter((row) => !pageKeys.has(projectedItemKey(row)))
    ];
  }
  if (visible.length === projection.visibleTurnItems.length && visible.every((row, index) => row === projection.visibleTurnItems[index]))
    return projection;
  return {
    ...projection,
    turnItems: [...turnItemById.values()],
    visibleTurnItems: renumberVisible(visible)
  };
}
function applyHistoryPageMeta(current, page) {
  return {
    historyCursor: page.nextCursor,
    hasMoreHistory: page.hasMoreHistory,
    loading: false,
    error: null,
    expanded: true,
    latestLocalTurnOrdinal: current.latestLocalTurnOrdinal
  };
}
function shouldShowLoadEarlierControl(history) {
  return history.hasMoreHistory || history.error !== null;
}
export {
  EMPTY_THREAD_HISTORY_META,
  applyHistoryPageMeta,
  clearActiveHistoryLoading,
  isActiveHistoryRequestCursor,
  mergeOlderHistoryIntoProjection,
  shouldShowLoadEarlierControl
};
