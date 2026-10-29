/* An alert firing, a Compass call the reader asked to hear, or a paper fill, shown wherever the reader is: one chip at the window's top right for five
   seconds; a click opens the alerts drawer. It is the only voice for a firing, so a chart of the name does not
   repeat it. */

import { UndoToasts } from '../ui/undo';
import { useEffect, useRef, useState } from 'react';
import { flashAlert } from '../../brand/markState';
import { useNavigate } from 'react-router-dom';
import { firedWords, useAllAlerts, type FiredRecord } from '../gex/alertStore';
import { usePaperToasts, type PaperToast } from '../../data/paper/store';
import { dirInk, usdSigned } from '../review/words';
import { chime } from '../../core/sound';
import { ALERT, alpha } from '../gex/paletteInk';
import { openAlertsDrawer } from '../../data/alertsDrawer';
import { useCompassPings } from '../../data/compassAlerts';

/** How long a chip stays — long enough to read on a page you were not looking at */
export const TOAST_MS = 5000;
const AT_MOST = 4;

/** A paper chip's ink: a fill is silver (where you are); an evaluation's end, its verdict's */
const paperInk = (t: PaperToast): string => (t.kind === 'failed' ? 'rgb(var(--bear))' : t.kind === 'passed' ? 'rgb(var(--bull))' : t.kind === 'day-over' || t.kind === 'flat' || t.kind === 'rule' ? 'rgb(var(--warn))' : 'rgb(var(--silver))');

const AlertToasts = () => {
  const names = useAllAlerts();
  const paper = usePaperToasts();
  const navigate = useNavigate();
  const [, wake] = useState(0);
  const now = Date.now();
  const shown: { ticker: string; r: FiredRecord }[] = names
    .flatMap(n => n.fired.map(r => ({ ticker: n.ticker, r })))
    .filter(x => now - x.r.at < TOAST_MS)
    .sort((a, b) => b.r.at - a.r.at)
    .slice(0, AT_MOST);
  /* the paper account's, in the same column — a verdict stays twice as long as a fill */
  const paperShown = paper.filter(t => now - t.at < (t.kind === 'failed' || t.kind === 'passed' ? TOAST_MS * 2 : TOAST_MS)).slice(0, AT_MOST);
  /* Compass's calls, on the sleeves and names switched on in Compass — a call stays twice as long, it is a decision */
  const calls = useCompassPings().filter(p => now - p.at < TOAST_MS * 2).slice(0, AT_MOST);

  /* A NEW chip CHIMES, once (Settings › The desk, "Alerts out loud"): the
     keys already heard are kept, so a re-render never rings twice */
  const heard = useRef<Set<string>>(new Set());
  useEffect(() => {
    let fresh = false;
    for (const k of [...shown.map(x => `${x.ticker}:${x.r.key}`), ...calls.map(c => `compass:${c.id}`)]) {
      if (!heard.current.has(k)) {
        heard.current.add(k);
        fresh = true;
      }
    }
    if (fresh) {
      chime();
      /* the mark's cursor flashes the warning ink twice (brand/markState.ts) */
      flashAlert();
    }
  });

  /* wake when the oldest chip on screen is due to leave */
  useEffect(() => {
    if (shown.length === 0 && paperShown.length === 0 && calls.length === 0) return;
    const soonest = Math.min(...shown.map(x => x.r.at + TOAST_MS), ...paperShown.map(t => t.at + (t.kind === 'failed' || t.kind === 'passed' ? TOAST_MS * 2 : TOAST_MS)), ...calls.map(c => c.at + TOAST_MS * 2)) - Date.now();
    const id = window.setTimeout(() => wake(t => t + 1), Math.max(0, soonest) + 20);
    return () => window.clearTimeout(id);
  });

  /* The column stays mounted, empty or not: the undo chips (ui/undo.tsx) stand at its top whatever the alerts are
     doing, and a polite live region has to be in the page before what it says arrives */
  return (
    <div className="fixed top-3 right-3 z-[86] flex flex-col items-end gap-1.5 pointer-events-none" aria-live="polite" aria-label="Notices" data-alert-toasts>
      <UndoToasts />
      {paperShown.map(t => (
        <button
          key={t.id}
          onClick={() => navigate('/practice/paper')}
          title="Open the Live Chart"
          className="shell-toast pointer-events-auto inline-flex items-center gap-2 h-7 pl-2.5 pr-3 rounded-md border bg-canvas/85 backdrop-blur-md backdrop-saturate-150 shadow-lg shadow-black/40 font-mono text-[11px] select-none"
          style={{ borderColor: `color-mix(in srgb, ${paperInk(t)} 50%, transparent)` }}
          data-paper-toast={t.kind}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: paperInk(t) }} aria-hidden />
          {t.account && <span className="text-textSecondary">{t.account} ·</span>}
          <span className="text-textPrimary">{t.words}</span>
          {t.pnl != null && <span className={`font-semibold ${dirInk(t.pnl)}`}>{usdSigned(t.pnl)}</span>}
          <span className="text-t9 uppercase tracking-wider text-textMuted">paper</span>
        </button>
      ))}
      {calls.map(c => (
        <button
          key={`compass:${c.id}`}
          onClick={() => navigate(`/compass/${c.id}`)}
          title="Open the call on Compass"
          className="shell-toast pointer-events-auto inline-flex items-center gap-2 h-7 pl-2.5 pr-3 rounded-md border border-silver/50 bg-canvas/85 backdrop-blur-md backdrop-saturate-150 shadow-lg shadow-black/40 font-mono text-[11px] select-none"
          data-compass-toast={c.id}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-silver" aria-hidden />
          <span className="font-bold text-textPrimary">{c.contract}</span>
          <span className="text-textSecondary">{c.sleeve}</span>
          <span className="text-t9 uppercase tracking-wider text-textMuted">Compass call</span>
        </button>
      ))}
      {shown.map(x => (
        <button
          key={`${x.ticker}:${x.r.key}`}
          onClick={openAlertsDrawer}
          title="Open the alerts"
          className="shell-toast pointer-events-auto inline-flex items-center gap-2 h-7 pl-2.5 pr-3 rounded-md border bg-canvas/85 backdrop-blur-md backdrop-saturate-150 shadow-lg shadow-black/40 font-mono text-[11px] select-none"
          style={{ color: ALERT, borderColor: alpha(ALERT, 0.5) }}
          data-alert-toast={x.r.key}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: ALERT }} aria-hidden />
          <span className="font-bold">{x.ticker}</span>
          <span className="text-textPrimary">{firedWords(x.r.alert, x.ticker)}</span>
          <span className="text-t9 uppercase tracking-wider text-textMuted">alerted</span>
        </button>
      ))}
    </div>
  );
};

export default AlertToasts;
