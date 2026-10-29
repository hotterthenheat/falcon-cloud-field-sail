/* A bar-less sideways scroller (`.scroll-row`, index.css) marks an edge with more behind it via
   data-scroll-more="left" | "right", and the stylesheet fades that edge. */

/** Marks `row` now and as it scrolls or resizes; the return takes the marks and the listeners away */
export function attachScrollMore(row: HTMLElement): () => void {
  const mark = () => {
    const more: string[] = [];
    if (row.scrollLeft > 1) more.push('left');
    if (row.scrollLeft + row.clientWidth < row.scrollWidth - 1) more.push('right');
    if (more.length) row.setAttribute('data-scroll-more', more.join(' '));
    else row.removeAttribute('data-scroll-more');
  };
  row.addEventListener('scroll', mark, { passive: true });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(mark) : null;
  ro?.observe(row);
  mark();
  return () => {
    row.removeEventListener('scroll', mark);
    ro?.disconnect();
    row.removeAttribute('data-scroll-more');
  };
}
