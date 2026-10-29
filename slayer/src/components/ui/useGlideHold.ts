/*
  A heavy column (a grown grid, a strip of cards) holds its width during the sidebar's 300 ms glide and takes the new
  width once it ends, instead of relaying every row each frame; main clips the overlap (index.css [data-glide]). Width
  only, no compositor layer: promoting a sixteen-screen grid rasters all of it first. A callback ref, so a remounted
  wrapper re-subscribes.
*/

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

export default useGlideHold;
