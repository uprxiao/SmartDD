export interface ImageGalleryPicture { id: string | number; src: string; alt: string; fallbackSrc?: string; downloadSrc?: string; name?: string; path?: string }
export interface ImageGalleryProps<P extends ImageGalleryPicture> {
  initial: { picture: P; pictures: P[] }; overlay: boolean; download: boolean;
  onClose(): void; onDownload?(picture: P): void | Promise<unknown>; onRetry?(picture: P): Promise<void>;
  onSaveContent?(content: import('./image-download.mjs').ImageDownloadContent, picture: P): Promise<unknown>;
  resolveDownload?(picture: P, signal: AbortSignal): Promise<string | Blob | null>;
  onNavigate?(index: number): void;
}
export function ImageGallery<P extends ImageGalleryPicture>(props: ImageGalleryProps<P>): import('react').ReactElement;
