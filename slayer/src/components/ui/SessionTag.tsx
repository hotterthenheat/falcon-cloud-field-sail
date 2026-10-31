/* The session a page's numbers belong to, from the one session rule (core/session.ts): in the regular session they are
   live; outside it the vendor's books are the last regular session's (named by its day) while the clock is in the
   overnight, the pre-market, after hours or closed. Re-renders when the session turns. */

import { PHASE_LABEL, sessionBadge, useMarketSession } from '../../core/session';
import { sessionWhen } from '../../data/dayChange';

export const SessionTag = ({ className = '', what = 'Numbers' }: { className?: string; what?: string }) => {
  const s = useMarketSession();
  const regular = s.phase === 'regular';
  const last = sessionWhen(s.lastRegular);
  const words = regular ? 'Regular session · live' : `${sessionBadge(s)}${last ? ` · ${what.toLowerCase()} of ${last}` : ''}`;
  const title = regular
    ? `${what} are the regular session's, live.`
    : `${PHASE_LABEL[s.phase]} now. ${what} are the last regular session's${last ? ` (${last})` : ''} unless marked otherwise; prices carry their own session tag (ON, PM, AH).`;
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest whitespace-nowrap ${regular || s.phase !== 'closed' ? 'text-textSecondary' : 'text-textMuted'} ${className}`} title={title} data-session-tag={s.phase}>
      <span aria-hidden className={`inline-block h-1.5 w-1.5 rounded-full ${s.phase === 'closed' ? 'bg-textMuted' : 'bg-bull'}`} />
      {words}
    </span>
  );
};
