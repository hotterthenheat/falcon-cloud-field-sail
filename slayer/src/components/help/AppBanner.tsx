/* THE BANNER over every terminal page: one line for an outage or an announcement, from the one typed source
   (data/banner.ts): the hand-written announcements and the outages the app's own reads report (data/pathHealth.ts),
   e.g. live quotes down for 45 s. One message at a time, the most urgent first; dismissed per message (kept in
   localStorage), and a new outage shows again. A polite live region, so a screen reader hears it arrive once. */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, TriangleAlert, X } from 'lucide-react';
import { ANNOUNCEMENTS, outageMessages, readDismissed, selectBanner, writeDismissed, type BannerMessage } from '../../data/banner';
import { usePathReads } from '../../data/pathHealth';
import { useBeat } from '../ui/Freshness';

/** The messages that stand now (in their window, outages past their wait), each with the instant it began */
export function useBannerMessages(): (BannerMessage & { seenAt: number })[] {
  const paths = usePathReads();
  const now = useBeat();
  return useMemo(() => {
    const t = Math.max(now, Date.now() - 5_000);
    const outages = outageMessages(paths, t).map(m => ({ ...m, seenAt: Number(m.id.split(':')[2]) || t }));
    const notes = ANNOUNCEMENTS.filter(m => (m.from == null || t >= m.from) && (m.until == null || t < m.until)).map(m => ({ ...m, seenAt: m.from ?? 0 }));
    return [...outages, ...notes];
  }, [paths, now]);
}

const AppBanner = () => {
  const messages = useBannerMessages();
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const shown = selectBanner(messages, dismissed, Date.now());
  if (!shown) return null;
  const outage = shown.tone === 'outage';
  const Icon = outage ? TriangleAlert : Info;
  const dismiss = () => {
    const next = new Set(dismissed);
    next.add(shown.id);
    setDismissed(next);
    writeDismissed(next);
  };
  return (
    <div
      role="status"
      aria-live="polite"
      className={`shrink-0 flex items-start sm:items-center gap-2.5 px-4 lg:px-6 2xl:px-8 py-2 border-b text-t12 ${outage ? 'border-warn/30 bg-warn/[0.07] text-textPrimary' : 'border-borderSubtle bg-ink/[0.03] text-textSecondary'}`}
      data-app-banner={shown.tone}
      data-banner-id={shown.id}
    >
      <Icon className={`w-3.5 h-3.5 shrink-0 mt-[2px] sm:mt-0 ${outage ? 'text-warn' : 'text-silver'}`} aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">
        <span className="sr-only">{outage ? 'Outage: ' : 'Notice: '}</span>
        {shown.text}
        {shown.link && (
          <>
            {' '}
            <Link to={shown.link.to} className="whitespace-nowrap font-medium text-textPrimary underline decoration-borderMuted underline-offset-4 hover:decoration-textPrimary" data-banner-link>
              {shown.link.label}
            </Link>
          </>
        )}
      </p>
      {shown.dismissible !== false && (
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss this notice"
          title="Dismiss"
          className="tap-40 shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-borderFocus"
          data-banner-dismiss
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export default AppBanner;
