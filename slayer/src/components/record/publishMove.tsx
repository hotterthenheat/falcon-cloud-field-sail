/* THE MOVE AT PUBLISH, SAID AS WHICH MOVE IT IS (the third audit, 2026-10-23): the regular session's move first, the
   pre-market or after-hours move apart and named — never the after-hours move printed as the day's. */
import type { NewsPrediction } from '../../data/news';

const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;
const SHORT = { 'pre-market': 'PM', 'after hours': 'AH' } as const;

export function PublishMove({ p, short = false }: { p: NewsPrediction; short?: boolean }) {
  const ext = p.extMovePct != null && p.extWord ? p.extMovePct : null;
  const extTag = p.extWord ? (short ? SHORT[p.extWord] : p.extWord) : '';
  if (p.measured) {
    return (
      <span title={`The regular session's move when the story crossed${ext != null ? `; ${p.extWord} ${signed(ext)} apart` : ''}`}>
        <span className={p.expMove1dPct >= 0 ? 'text-bull' : 'text-bear'}>{signed(p.expMove1dPct)}</span>
        {ext != null && !short && <span className="font-normal text-textMuted"> · {extTag} {signed(ext)}</span>}
      </span>
    );
  }
  if (ext != null) {
    return (
      <span className="font-normal text-textMuted" title={`Only the ${p.extWord} move is known at publish — the session's own move is not in hand`}>
        {extTag} {signed(ext)}
      </span>
    );
  }
  return <span className="text-textMuted">—</span>;
}

/** The story's name in a row: its ticker, else "mentions MSFT" for a company it only names, else macro or no name */
export const storyNameWord = (item: { ticker: string | null; category: string; mentions?: string[] }): string =>
  item.ticker ?? (item.mentions?.length ? `mentions ${item.mentions[0]}` : item.category === 'Macro' ? 'MACRO' : 'NO NAME');
