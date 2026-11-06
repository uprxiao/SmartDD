import {attachmentTextKind} from '../../../src/shared/file-attachment.mjs';
// Synthetic prototype files have explicit byte-kind labels; binary/artifact
// labels never become text just because their mock attachment has a MIME.
export function prototypeAttachmentFile(file,attachment){
  if(!attachment||!['code','markdown','html'].includes(file?.kind))return file;
  const textKind=attachmentTextKind(file.path,attachment.mimeType);
  return{...file,kind:textKind==='markdown'?'markdown':textKind==='html'?'html':'code'};
}
export const attachmentExamples=[
  {id:'plain',label:'TXT 回调',path:'附件回调示例.txt',kind:'code',mimeType:'text/plain',text:'本机附件只读示例。\n特殊回调仅保留在当前会话。\n'},
  {id:'markdown',label:'Markdown 附件',path:'附件示例.md',kind:'markdown',mimeType:'text/html',text:'# Markdown 附件（合成）\n\n**只读，后缀优先于MIME。**\n'},
  {id:'mdx',label:'MDX 源码',path:'附件示例.mdx',kind:'markdown',mimeType:'text/markdown',text:'# MDX 附件保持源码\n\n<Component />\n'},
  {id:'mime-markdown',label:'无扩展 Markdown',path:'附件 MIME Markdown',kind:'code',mimeType:'text/markdown',text:'# MIME Markdown（合成）\n\n**无扩展只读回退。**\n'},
  {id:'mime-alias',label:'无扩展 Markdown 别名',path:'附件 MIME Alias',kind:'code',mimeType:'text/x-markdown',text:'# MIME 别名（合成）\n\n**工程支持的text/x-markdown。**\n'},
  {id:'mime-html',label:'无扩展 HTML',path:'附件 MIME HTML',kind:'code',mimeType:'text/html',text:'<!doctype html><meta charset="UTF-8"><h1>HTML 附件（合成）</h1><p>沿用原型隔离文档组件。</p>'},
  {id:'unknown',label:'未知扩展不覆盖',path:'附件 MIME.unknown',kind:'code',mimeType:'text/markdown',text:'# 已有未知后缀\n\n保持源码，不被MIME强制覆盖。\n'},
];
