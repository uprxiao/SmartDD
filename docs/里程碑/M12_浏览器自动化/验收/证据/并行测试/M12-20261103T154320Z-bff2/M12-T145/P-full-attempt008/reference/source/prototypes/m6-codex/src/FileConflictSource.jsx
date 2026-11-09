import { forwardRef } from 'react';
import { FileSourceView } from '../../../src/renderer/features/files/source-view.tsx';
import { fileInlineDiffPolicy } from '../../../src/shared/file-inline-diff.mjs';

/** Synthetic prototype data with the same raw source, diff and budget core. */
export const FileConflictSource=forwardRef(function FileConflictSource({text,diskText,filename,onEdit,onSelect,onComposition},ref){
 const policy=fileInlineDiffPolicy(diskText??null,text);
 return <div className="fw-conflict-source" data-inline-diff-state={policy.state}>
  <div className="fw-save-strip" role="status">{policy.reason||'差异对比：磁盘版本 → 我的修改'}</div>
  <FileSourceView ref={ref} text={text} original={diskText??null} filename={filename} readOnly={false} label="文件编辑器" onEdit={onEdit} onSelect={onSelect} onComposition={onComposition}/>
 </div>;
});
