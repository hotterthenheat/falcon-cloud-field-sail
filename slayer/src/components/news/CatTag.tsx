import type { NewsCategory } from '../../data/news';

/* Category colours: a muted categorical palette that never borrows the bull, bear, interface or supreme inks. */
/* the hues live in theme/tokens.css; the light set holds 5.6:1 or better on white */
export const CAT_COLOR: Record<NewsCategory, string> = {
  Earnings: 'rgb(var(--cat-earnings))', // amber — the numbers print
  Guidance: 'rgb(var(--cat-guidance))', // cornflower — forward-looking
  Analyst: 'rgb(var(--cat-analyst))', // periwinkle — opinion
  Macro: 'rgb(var(--cat-macro))', // teal — the big picture
  'M&A': 'rgb(var(--cat-ma))', // pink — deals
  Product: 'rgb(var(--cat-product))', // sage — launches
  Regulatory: 'rgb(var(--cat-regulatory))', // muted rose — friction
  General: 'rgb(var(--text-muted))', // grey — a story of no named beat
};

const CatTag = ({ category, size = 10 }: { category: NewsCategory; size?: 9 | 10 }) => (
  <span
    className={`inline-flex items-center gap-1.5 font-mono font-semibold uppercase tracking-wider whitespace-nowrap ${size === 9 ? 'text-t9' : 'text-t10'}`}
    style={{ color: CAT_COLOR[category] }}
  >
    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: CAT_COLOR[category] }} />
    {category}
  </span>
);

export default CatTag;
