import type { ImageGalleryPicture } from './ImageGallery.jsx';
export interface ImageDownloadContent { name: string; base64: string }
export interface ImageDownloadOptions<P extends ImageGalleryPicture> {
  saveContent?: (content: ImageDownloadContent, picture: P) => Promise<unknown>;
  resolve?: (picture: P, signal: AbortSignal) => Promise<string | Blob | null>;
  signal: AbortSignal;
}
export function downloadImageCopy<P extends ImageGalleryPicture>(picture: P, options: ImageDownloadOptions<P>): Promise<unknown>;
