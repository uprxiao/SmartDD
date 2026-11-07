export const EXPECTED=['M9-T-P03','M9-T-P04','M9-T-P07'];
export const exactCases=rows=>Array.isArray(rows)&&rows.length===3&&new Set(rows.map(x=>x.caseId)).size===3&&EXPECTED.every(k=>rows.some(x=>x.caseId===k));
