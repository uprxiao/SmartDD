export const ORIGINAL_KEYS=Object.freeze(['light-xlsx','light-xlsm','dark-xlsx','dark-xlsm']);
export const hasExactOriginalCases=rows=>Boolean(Array.isArray(rows)&&rows.length===4&&new Set(rows.map(x=>x?.key)).size===4&&ORIGINAL_KEYS.every(key=>rows.some(x=>x?.key===key)));
