/* THE NOTIFICATION CENTER: one list of what the terminal told you this session — alerts that fired, Compass calls you
   asked to hear, paper fills and verdicts, and the banner's outage or announcement — newest first, each read or
   unread, each clearable (data/notices.ts over the stores that already speak). The alerts drawer stays the place to
   SET alerts; this is where everything that happened is kept. A sheet from the right, the drawers' own. */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Bell, CheckCheck, Inbox, Trash2, X } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../shadcn/sheet';
import { useLayeredEscape } from '../shadcn/layer';
import { Button } from '../shadcn/button';
import { ToggleGroup, ToggleGroupItem } from '../shadcn/toggle-group';
import { closeNotices, useNoticesOpen } from '../../data/overlayDoors';
import { openAlertsDrawer } from '../../data/alertsDrawer';
import { clearFiredLog, firedWords, markSeenAll, useAllAlerts } from '../gex/alertStore';
import { useCompassPings } from '../../data/compassAlerts';
import { usePaperToasts } from '../../data/paper/store';
import { clearNotices, markRead, markUnread, unreadCount, useMergedNotices, type Notice, type NoticeKind } from '../../data/notices';
import { useBannerMessages } from './AppBanner';
import { ALERT } from '../gex/paletteInk';
import { useTicker } from '../../context/MarketDataContext';
import { nyClock, nyDay, nyIsoDate } from '../../core/nyTime';
import { usdSigned } from '../review/words';

const KIND_WORDS: Record<NoticeKind, string> = { alert: 'Alert', compass: 'Compass call', paper: 'Paper Trade', status: 'Notice' };
type Filter = 'all' | 'unread';

const when = (at: number) => (nyIsoDate(at) === nyIsoDate(Date.now()) ? nyClock(at, { seconds: true, zone: true }) : `${nyDay(at)}, ${nyClock(at, { zone: true })}`);
const dotInk = (n: Notice): string =>
  n.tone === 'alert' ? ALERT : n.tone === 'bull' ? 'rgb(var(--bull))' : n.tone === 'bear' ? 'rgb(var(--bear))' : n.tone === 'warn' ? 'rgb(var(--warn))' : 'rgb(var(--silver))';

/** Every store's items in the one shape */
function useSourceNotices(): Notice[][] {
  const names = useAllAlerts();
  const pings = useCompassPings();
  const paper = usePaperToasts();
  const banner = useBannerMessages();
  const alerts = useMemo<Notice[]>(
    () =>
      names.flatMap(n =>
        n.fired.map(r => ({ id: `alert:${n.ticker}:${r.key}`, kind: 'alert' as const, at: r.at, title: `${n.ticker} alerted`, detail: firedWords(r.alert, n.ticker), ticker: n.ticker, tone: 'alert' as const })),
      ),
    [names],
  );
  const calls = useMemo<Notice[]>(
    () => pings.map(p => ({ id: `compass:${p.id}`, kind: 'compass' as const, at: p.at, title: `Compass called ${p.contract}`, detail: `${p.ticker} · ${p.sleeve}`, ticker: p.ticker, to: `/compass/${p.id}`, tone: 'silver' as const })),
    [pings],
  );
  const fills = useMemo<Notice[]>(
    () =>
      paper.map(t => ({
        id: `paper:${t.id}`,
        kind: 'paper' as const,
        at: t.at,
        title: t.account ? `${t.account} · ${t.words}` : t.words,
        detail: t.pnl != null ? `${usdSigned(t.pnl)} · pretend money` : 'Pretend money',
        to: '/practice/paper',
        tone: t.kind === 'failed' ? ('bear' as const) : t.kind === 'passed' ? ('bull' as const) : ('silver' as const),
      })),
    [paper],
  );
  const notices = useMemo<Notice[]>(
    () => banner.map(m => ({ id: `status:${m.id}`, kind: 'status' as const, at: m.seenAt, title: m.tone === 'outage' ? 'Data outage' : 'Announcement', detail: m.text, to: m.link?.to, tone: m.tone === 'outage' ? ('warn' as const) : ('silver' as const) })),
    [banner],
  );
  return [alerts, calls, fills, notices];
}

const NoticeCenter = () => {
  const open = useNoticesOpen();
  const parts = useSourceNotices();
  const list = useMergedNotices(parts);
  const names = useAllAlerts();
  const navigate = useNavigate();
  const { activeTicker, changeTicker } = useTicker();
  const [filter, setFilter] = useState<Filter>('all');
  const onEscapeKeyDown = useLayeredEscape(open, closeNotices);
  const unread = unreadCount(list);
  const shown = filter === 'unread' ? list.filter(n => !n.read) : list;

  const go = (n: Notice) => {
    markRead([n.id]);
    if (n.kind === 'alert') {
      closeNotices();
      if (n.ticker && n.ticker !== activeTicker) changeTicker(n.ticker);
      openAlertsDrawer();
      return;
    }
    if (n.to) {
      if (n.ticker && n.ticker !== activeTicker) changeTicker(n.ticker);
      navigate(n.to);
      closeNotices();
    }
  };
  const readAll = () => {
    markRead(list.map(n => n.id));
    /* the bell's count agrees */
    markSeenAll();
  };
  const clearAll = () => {
    clearNotices(list.map(n => n.id));
    /* the alerts drawer's own "Clear" on the Alerted shelf, so the two lists agree */
    names.forEach(n => clearFiredLog(n.ticker));
    markSeenAll();
  };

  return (
    <Sheet open={open} onOpenChange={next => !next && closeNotices()}>
      <SheetContent onEscapeKeyDown={onEscapeKeyDown} data-notice-center>
        <div className="h-12 shrink-0 flex items-center gap-2.5 px-3.5 border-b border-borderSubtle/70">
          <span className="w-6 h-6 rounded-md border border-borderSubtle bg-ink/[0.03] flex items-center justify-center shrink-0" aria-hidden>
            <Inbox className="w-3.5 h-3.5 text-textSecondary" strokeWidth={1.75} />
          </span>
          <SheetTitle>Notifications</SheetTitle>
          <SheetDescription className="tnum" data-notice-facts>
            <span className="text-textSecondary">{unread}</span> unread · {list.length} in all
          </SheetDescription>
          <Button variant="ghost" size="icon" onClick={closeNotices} aria-label="Close the notifications" title="Close (Esc)" className="ml-auto" data-notice-close>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3.5 py-2 border-b border-borderSubtle/60">
          <ToggleGroup type="single" size="sm" value={filter} onValueChange={v => v && setFilter(v as Filter)} aria-label="Show">
            <ToggleGroupItem value="all" data-notice-filter="all">Everything</ToggleGroupItem>
            <ToggleGroupItem value="unread" data-notice-filter="unread">Unread</ToggleGroupItem>
          </ToggleGroup>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="flat" size="xs" onClick={readAll} disabled={!unread} data-notice-read-all>
              <CheckCheck className="w-3 h-3" aria-hidden /> Mark all read
            </Button>
            <Button variant="flat" size="xs" onClick={clearAll} disabled={!list.length} data-notice-clear-all>
              <Trash2 className="w-3 h-3" aria-hidden /> Clear
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto" data-notice-body>
          {shown.length === 0 ? (
            <div className="m-3.5 rounded-md border border-dashed border-borderSubtle/70 px-4 py-6 flex flex-col items-center gap-2 text-center" role="status">
              <Bell className="w-4 h-4 text-textMuted" strokeWidth={1.5} aria-hidden />
              <p className="text-t11 leading-snug text-textMuted max-w-[280px]">
                {filter === 'unread' && list.length ? 'Everything here is read.' : 'Nothing yet. Alerts that fire, Compass calls you asked to hear, paper fills and outages land here while this tab is open.'}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  closeNotices();
                  openAlertsDrawer();
                }}
              >
                Set an alert
              </Button>
            </div>
          ) : (
            <ul aria-label="Notifications">
              {shown.map(n => (
                <li key={n.id} className={`group flex items-start gap-2.5 px-3.5 py-2.5 border-b border-borderSubtle/60 ${n.read ? '' : 'bg-ink/[0.025]'}`} data-notice={n.id} data-notice-read={n.read || undefined}>
                  <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: n.read ? 'transparent' : dotInk(n), boxShadow: n.read ? `inset 0 0 0 1px ${dotInk(n)}` : undefined }} aria-hidden />
                  <button type="button" onClick={() => go(n)} className="min-w-0 flex-1 text-left flex flex-col gap-[2px] rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-borderFocus" data-notice-open>
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="sr-only">{n.read ? 'Read. ' : 'Unread. '}</span>
                      <span className={`truncate text-t12 ${n.read ? 'text-textSecondary' : 'text-textPrimary font-medium'}`}>{n.title}</span>
                    </span>
                    <span className="text-t11 leading-snug text-textSecondary break-words">{n.detail}</span>
                    <span className="font-mono text-t9 tnum text-textMuted">
                      {KIND_WORDS[n.kind]} · {when(n.at)}
                      {(n.to || n.kind === 'alert') && <ArrowUpRight className="inline w-2.5 h-2.5 ml-1 -mt-px" aria-hidden />}
                    </span>
                  </button>
                  <div className="shrink-0 flex items-center gap-0.5">
                    <Button variant="ghost" size="icon" onClick={() => (n.read ? markUnread(n.id) : markRead([n.id]))} aria-label={n.read ? `Mark unread — ${n.title}` : `Mark read — ${n.title}`} title={n.read ? 'Mark unread' : 'Mark read'} className="tap-40" data-notice-toggle>
                      <CheckCheck className={`w-3 h-3 ${n.read ? 'opacity-40' : ''}`} />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => clearNotices([n.id])} aria-label={`Clear — ${n.title}`} title="Clear it" className="tap-40" data-notice-clear>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="shrink-0 px-3.5 py-2 border-t border-borderSubtle/70 font-mono text-t9 leading-snug text-textMuted">Kept while this tab is open. Nothing is sent anywhere.</p>
      </SheetContent>
    </Sheet>
  );
};

export default NoticeCenter;
