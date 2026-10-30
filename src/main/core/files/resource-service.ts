import { FILE_LIMITS } from '@shared/files';
import { FILE_IMAGE_LIMIT, FILE_RESOURCE_SCHEME } from '@shared/file-resource';
import { FileMediaService, type BoundMedia } from './media-service';
import type { FileRef } from '@shared/files';

/** Reuse the revision-bound token/range/lifetime implementation. Ordinary
 * images and PDFs require the owner-gated protocol; a shared Blob fallback
 * would recreate the cross-window capability leak. */
export class FileResourceService extends FileMediaService {
  constructor(resolve: (owner: string, ref: FileRef) => BoundMedia) {
    super(resolve, { scheme: FILE_RESOURCE_SCHEME, requireProtocol: true, fetch: true, type: source => {
      const content = source.content;
      return content?.kind === 'pdf' ? { mime: 'application/pdf', limit: FILE_LIMITS.asset, limitMessage: 'PDF 超过 256 MiB 读取上限' }
        : content?.kind === 'image' && content.mime?.startsWith('image/') ? { mime: content.mime, limit: FILE_IMAGE_LIMIT, limitMessage: '图像超过 40 MiB 读取上限' } : null;
    } });
  }
}
