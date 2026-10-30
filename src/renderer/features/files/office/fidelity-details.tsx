import type { OfficeFidelityReport } from '@shared/file-office-fidelity';
import '../../../../shared/office-fidelity.css';

export const OFFICE_SIGNED_EDIT_WARNING = '此文件包含数字签名；编辑会使签名失效。当前仅供只读查看，原文件保持不变。';
export const OFFICE_LOSSY_COPY_WARNING = '副本将保留下面列出的损失或差异，可能无法完整显示或打开。原文件不会被覆盖，原件的未保存修改和草稿仍保留。';
export function OfficeFidelityDetails({ report }: { report: OfficeFidelityReport }) {
  return <div className="fw-office-fidelity-details"><strong>保真校验失败，已阻止覆盖原文件</strong>
    <ul>{report.issues.map((issue,index)=><li key={index}><span>{issue.message}</span>{issue.part&&<code>{issue.part}</code>}</li>)}</ul>
    {report.total>report.issues.length&&<p>共 {report.total} 项差异，显示前 {report.issues.length} 项。</p>}
  </div>;
}
