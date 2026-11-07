// Pure finite descriptor predicate; no App/DOM/native effects.
export const isReadyDescriptor=d=>Boolean(d&&d.visibleCount===1&&d.eligibleCount===1&&d.target?.enabled&&d.target?.hit&&Number.isFinite(d.target?.x)&&Number.isFinite(d.target?.y));
