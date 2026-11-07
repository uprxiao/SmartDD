export const EXPECTED=Object.freeze(['M9-T-D07:forward','M9-T-D07:back','M9-T-D07:refresh-and-normal-restart','M9-T-D15:layout','M9-T-D16:missing-file','M9-T-D16:unavailable-root','M9-T-D17:tree-focus','M9-T-D17:editor-focus']);
export const exactCases=rows=>Boolean(Array.isArray(rows)&&rows.length===8&&new Set(rows.map(x=>x?.caseId+':'+x?.state)).size===8&&EXPECTED.every(key=>rows.some(x=>x?.caseId+':'+x?.state===key)));

export const CONTINUATION=Object.freeze(EXPECTED.slice(3));
export const exactContinuation=rows=>Boolean(Array.isArray(rows)&&rows.length===5&&new Set(rows.map(x=>x?.caseId+':'+x?.state)).size===5&&CONTINUATION.every(key=>rows.some(x=>x?.caseId+':'+x?.state===key)));
