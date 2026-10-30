import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ImageGallery } from './ImageGallery.jsx';

/** Explicit adapter inputs. No host/OS meaning is inferred for the two original environment predicates. */
export function RoutedImageGallery({ routing, initial, onNavigate, ...props }) {
  // Zel admits a request at open time. Later flag changes affect V27's inner
  // presentation, rather than deleting the admitted request or reopening tnl.
  const [admitted] = useState(() => routing == null ? null :
    routing.outerEnvironmentAllowed === true && ['local', 'chatgpt'].includes(routing.scope) && routing.imageOverlayEnabled === true);
  const selected = useRef(initial.pictures.findIndex(p => p.id === initial.picture.id));
  const remember = useCallback(index => { selected.current = index; onNavigate?.(index); }, [onNavigate]);
  if (admitted === null) return <ImageGallery initial={initial} {...props} onNavigate={onNavigate} />;
  const portal = routing?.portal ?? routing?.contextPortal ?? null;
  const overlay = admitted && routing?.innerEnvironmentAllowed === true && portal == null && routing?.imageOverlayEnabled === true;
  const current = { ...initial, picture: initial.pictures[selected.current] ?? initial.picture };
  const gallery = <ImageGallery {...props} initial={current} overlay={overlay} download={admitted ? overlay : true} onNavigate={remember} />;
  return admitted && portal != null ? createPortal(gallery, portal) : gallery;
}
