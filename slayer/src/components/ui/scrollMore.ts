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
  /* A plain mouse has only the up-and-down wheel, and a bar-less row hides its sideways bar: without this, the tabs past
     a narrow rail's edge could not be reached with one (the button audit, 2026-11-01). The wheel turns the row sideways
     while it has room to go that way, and only on a row that does not scroll up and down itself. */
  const wheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollHeight > row.clientHeight + 1) return;
    const next = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, row.scrollLeft + e.deltaY));
    if (Math.abs(next - row.scrollLeft) < 1) return;
    row.scrollLeft = next;
    e.preventDefault();
  };
  row.addEventListener('wheel', wheel, { passive: false });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(mark) : null;
  ro?.observe(row);
  mark();
  return () => {
    row.removeEventListener('scroll', mark);
    row.removeEventListener('wheel', wheel);
    ro?.disconnect();
    row.removeAttribute('data-scroll-more');
  };
}
