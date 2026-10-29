/* A heavy column holds its width through the sidebar's 300 ms glide and takes the new width once it ends (main clips the overlap).
   Width only, no compositor layer (promoting a huge grid rasters all of it). */

import { useEffect, useState } from 'react';
import { onGlide } from '../../core/glide';

export function useGlideHold<T extends HTMLElement>(): (el: T | null) => void {
  const [el, setEl] = useState<T | null>(null);
  useEffect(() => {
    if (!el) return;
    return onGlide(
      () => {
        el.style.width = `${el.getBoundingClientRect().width}px`;
      },
      () => {
        el.style.width = '';
      }
    );
  }, [el]);
  return setEl;
}

