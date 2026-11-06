import { useMemo } from 'react';
import { FileCsvPreview as CsvTable } from '../../../src/renderer/features/files/csv/preview';

// Shared renderer/worker, synthetic strings only; no IPC or filesystem access.
export function FileCsvPreview({ kind = 'csv', path = `synthetic.${kind}`, initialValue }) {
  const raw = initialValue ?? (kind === 'tsv' ? '阶段\t名称\t内容\r\nM9\t"中文🙂"\t"引号内\tTAB\n多行"\r\n' : '阶段,名称,编号,内容\r\nM9,"中文🙂",00012345678901234567890,"逗号,与换行\n=SUM(A1:A2)"\r\n');
  const buffer = useMemo(() => ({ instance: crypto.randomUUID(), raw, baseHash: 'synthetic', version: 0, file: { name: path.endsWith(`.${kind}`) ? path : `synthetic.${kind}` } }), [raw, kind, path]);
  return <CsvTable buffer={buffer} />;
}
