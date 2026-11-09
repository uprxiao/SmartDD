export const EXPECTED=['M9-T-P01','M9-T-P02','M9-T-P06'];
export const exactCases=rows=>Array.isArray(rows)&&rows.length===3&&new Set(rows.map(x=>x.caseId)).size===3&&EXPECTED.every(k=>rows.some(x=>x.caseId===k));
