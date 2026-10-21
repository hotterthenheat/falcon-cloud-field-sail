/*
==================================================
  SLAYER TERMINAL - A ROW THAT SAYS IT GOES ON
  (components/ui/scrollMore.ts)

  A row that scrolls sideways without a bar (the
  `.scroll-row` class, index.css) marks the edge
  with more behind it — data-scroll-more="left",
  "right" or both — and the stylesheet fades that
  edge. The Map's band on a phone had this (the
  re-audit's H2); the guides' drawings, 400 wide in
  a narrower card, scrolled with no sign of it (the
  owner, 2026-10-14: "the caption ends at 'green:
  the' … it looks broken"). One helper for both.
==================================================
*/

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
