export interface ImageGalleryPicture { id: string | number; src: string; alt: string }
export function ImageGallery<P extends ImageGalleryPicture>(props: {
  initial: { picture: P; pictures: P[] }; overlay: boolean; download: boolean;
  onClose(): void; onDownload(picture: P): void; onRetry?(picture: P): Promise<void>;
}): import('react').ReactElement;
