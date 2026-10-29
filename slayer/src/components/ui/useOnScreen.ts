/* Whether an element is in the viewport (IntersectionObserver), so off-screen boxes can skip work. A callback ref, so
   it binds whatever element the host renders. */

import { useEffect, useState } from 'react';

export function useOnScreen<T extends HTMLElement>(margin = '120px'): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(entries => setOn(entries[0]?.isIntersecting ?? true), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [el, margin]);
  return [setEl, on];
}

