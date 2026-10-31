import { createHash } from 'node:crypto';
import type { OfficeFidelityIssue, OfficeFidelityReport } from '@shared/file-office-fidelity';
import { OfficePackage } from './package';
import { OfficeRelationships } from './relationships';

/** Runs inside the bounded document Worker. The intended model has already
 * applied the operation's exact part plan; a layout/export result cannot alter
 * another part, even if its ZIP part count and declared hash still look valid. */
export async function verifyOfficeCandidate(expected: OfficePackage, bytes: Uint8Array, claimedHash: string): Promise<OfficeFidelityReport> {
  const issues: OfficeFidelityIssue[] = []; let total = 0;
  const add = (issue: OfficeFidelityIssue) => { total++; if (issues.length < 50) issues.push(issue); };
  if (createHash('sha256').update(bytes).digest('hex') !== claimedHash) add({ kind: 'invalid', message: '候选字节与物化哈希不一致' });
  let actual: OfficePackage;
  try { actual = await OfficePackage.read(bytes); }
  catch (error) { add({ kind: 'invalid', message: `候选包无法验证：${error instanceof Error ? error.message.slice(0, 400) : '读取失败'}` }); return { total, issues }; }
  const before = expected.hashes(), after = actual.hashes();
  for (const name of expected.names()) {
    const part = name.length > 512 ? name.slice(0, 512) + '…' : name;
    if (!Object.hasOwn(after,name)) add({ kind: 'missing', part, message: '非预期缺失' });
    else if (before[name] !== after[name]) add({ kind: 'changed', part, message: '与本次合法编辑后的内容不一致' });
  }
  for (const name of actual.names()) if (!Object.hasOwn(before,name)) add({ kind: 'added', part: name.length > 512 ? name.slice(0, 512) + '…' : name, message: '非预期新增' });
  try { new OfficeRelationships(actual); }
  catch (error) { add({ kind: 'invalid', message: `关系或内容类型无效：${error instanceof Error ? error.message.slice(0, 400) : '校验失败'}` }); }
  return { total, issues };
}
