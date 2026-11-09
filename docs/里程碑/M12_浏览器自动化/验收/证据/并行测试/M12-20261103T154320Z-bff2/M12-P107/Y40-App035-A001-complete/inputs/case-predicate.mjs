export const SCENARIOS=['tabbar reorder leaves PTY untouched','file tab to terminal preserves tab order and activation','dirty tab drop and cancel preserve buffer/order; real Undo restores original','real renderer restart restores persisted fixed order; transient preview excluded'];
export const KEYS=['light','dark'].flatMap(t=>SCENARIOS.map(s=>t+'|'+s));
export const exactCases=rows=>Array.isArray(rows)&&rows.length===8&&rows.every(x=>x.caseId==='M9-T-Y40')&&new Set(rows.map(x=>x.theme+'|'+x.scenario)).size===8&&KEYS.every(k=>rows.some(x=>x.theme+'|'+x.scenario===k));
