export const MARKDOWN_IMAGE_REFERENCE_UNITS: 131072;
export function imageReferenceBoundary(source: string): number;
export function installImageReferenceWindow(md: any): void;
export function boundedImageReferences(md: any, source: string, bodyOffset?: number): Record<string, { href: string; title: string }> | undefined;
