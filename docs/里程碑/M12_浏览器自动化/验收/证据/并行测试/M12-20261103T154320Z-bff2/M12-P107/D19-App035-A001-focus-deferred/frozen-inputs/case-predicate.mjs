export const EXPECTED=Object.freeze(['light-switch','light-restart','dark-switch','dark-restart','changed-content']);
export const exactCases=rows=>Boolean(Array.isArray(rows)&&rows.length===5&&new Set(rows.map(x=>x?.key)).size===5&&EXPECTED.every(key=>rows.some(x=>x?.key===key)));
