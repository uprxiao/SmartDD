/** Reviewed V8 ct2. Flags are host capabilities, never inferred from a file
 * extension, OS, attachment title or the presence of a rendering library. */
export function docxRoute({importKind='docx',isAttachmentPreview=false,documentHostFlag=false,renderFlag=false,hostId}={}) {
  if(importKind!=='docx')return null;
  return isAttachmentPreview||!documentHostFlag||!(renderFlag&&hostId!=='durable')?'legacy':'popcorn';
}
