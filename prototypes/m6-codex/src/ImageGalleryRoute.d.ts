import type { ImageGalleryPicture, ImageGalleryProps } from './ImageGallery';

export interface ImageGalleryRouting {
  scope: 'local' | 'chatgpt' | 'other';
  imageOverlayEnabled: boolean;
  outerEnvironmentAllowed: boolean;
  innerEnvironmentAllowed: boolean;
  portal?: Element | null;
  contextPortal?: Element | null;
}
export function RoutedImageGallery<P extends ImageGalleryPicture>(props: ImageGalleryProps<P> & {
  routing?: ImageGalleryRouting;
}): import('react').ReactElement;
