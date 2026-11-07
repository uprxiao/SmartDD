export const EXPECTED=['M9-T-D08','M9-T-D10','M9-T-D11','M9-T-D18'];
export const exactCases=rows=>Array.isArray(rows)&&rows.length===4&&new Set(rows.map(x=>x.caseId)).size===4&&EXPECTED.every(k=>rows.some(x=>x.caseId===k));
