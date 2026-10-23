/*
==================================================
  SLAYER TERMINAL - 0DTE (Trace)
  The same-day money (Noah, 2026-08-30 — expansion
  page 6, from the reference's four fixed charts;
  Noah: "much more modern charts... 4 way 3 way
  2 way or just 1 chart kind of like our terrain
  page"). So: a PANE DESK — one to four NetFlowPanes,
  each with its own lens, moneyness cut and
  fullscreen door. Layout + lenses persist.

  TWO CONTROLS PER PANE (Noah, 2026-09-03, on the
  old six-way dropdown: "i am struggling to figure
  out the idea behind them"): a CUT of the book —
  by family (everything, stocks only, index funds
  only) or by sector — and a NAME SEARCH that puts
  one ticker on the pane. A cut asks which part of
  the book; a name asks which name. They no longer
  share a list, and no cut is called "single names".

  ONE JOB PER PAGE (Noah, same day: "is me picking a
  single stock name on the 0DTE subpage the same as
  me choosing a stock on the net flow page?" — it
  was: same generator, Net Flow's 0DTE clock). So
  the desk's search offers only the SAME-DAY COMPLEX
  — SPY, QQQ, IWM, the names 0DTE is made of and
  Net Flow's board of stocks does not rank — and
  its last row is a DOOR: any other name goes to
  Net Flow with the 0DTE clock set, one place for a
  stock's same-day lean, the board behind it.
==================================================
*/

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarketData } from '../../context/MarketDataContext';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import { isNetSegment, type MoneynessKey, type NetFlowSegment } from '../../data/flowBook';
import { useLiveBook, usePaneFlow } from '../../data/traceLive';
import { tapeSessionIso } from '../../data/traceLive';
import { VENDOR_TOTAL_NOTE } from '../../data/flowBook';
import { isLiveDay, sameDayWords, shortDay } from '../../components/trace/dayWords';
import { usd as fmtUsd } from '../../data/traceLive';
import { nyClock } from '../../core/nyTime';
import Lean from '../../components/trace/Lean';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import RichRead from '../../components/ui/RichRead';
import NetFlowPane from '../../components/trace/NetFlowPane';
import TraceBox, { Fact } from '../../components/trace/TraceBox';
import { OdteGuide } from '../../components/trace/TraceGuide';

const PANE_OPTIONS: DropdownOption<1 | 2 | 3 | 4>[] = [
  { value: 1, label: 'One pane', hint: 'One chart the width of the desk' },
  { value: 2, label: 'Two panes', hint: 'Side by side' },
  { value: 3, label: 'Three panes', hint: 'Two above, one across the bottom' },
  { value: 4, label: 'Four panes', hint: 'Two by two' },
];

const STORE_KEY = 'slayer_odte_v1';

interface PaneCfg {
  seg: NetFlowSegment;
  mny: MoneynessKey;
  /** A picked name — ticker mode; null = the cut */
  ticker: string | null;
}

interface OdteStore {
  count: 1 | 2 | 3 | 4;
  panes: PaneCfg[];
}

/* THE DEFAULT DESK IS SAME-DAY MONEY ON EVERY PANE (the audit, 2026-10-22): the SPY and QQQ panes drew each name's money
   across ALL expiries (the vendor has no same-day minute series for one name), and "Stocks only" drew nothing (the
   vendor's equity_only same-day series is empty). The four faces are now the vendor's same-day cuts — everything, the
   index funds, the index options — and SPY, labelled on its pane as every expiry. */
const DEFAULT_STORE: OdteStore = {
  count: 4,
  panes: [
    { seg: 'all', mny: 'all', ticker: null },
    { seg: 'index-funds', mny: 'all', ticker: null },
    { seg: 'indexes', mny: 'all', ticker: null },
    /* NOT SPY ACROSS EVERY EXPIRY (the retail pass, 2026-10-22: the same-day desk's fourth pane was "SPY · EVERY EXPIRY"):
       the vendor has no same-day minute series for one name, so every pane is a same-day cut — the fourth, the whole
       market's out-of-the-money same-day money */
    { seg: 'all', mny: 'otm', ticker: null },
  ],
};
/** The cuts the vendor has same-day minutes for: no sector (a sector's tide spans every expiry) and no stocks-only */
const SAME_DAY_CUTS = (seg: NetFlowSegment) => seg === 'all' || seg === 'index-funds' || seg === 'indexes';

const MNYS: MoneynessKey[] = ['all', 'itm', 'otm', 'atm'];


/* Stored lenses from the six-way days migrate: SPY/QQQ were names, Tech was
   the Technology sector. */
const LEGACY: Record<string, Partial<PaneCfg>> = {
  spy: { seg: 'all', ticker: 'SPY' },
  qqq: { seg: 'all', ticker: 'QQQ' },
  tech: { seg: 'sector:Technology' },
};

function loadStore(): OdteStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_STORE;
    const p = JSON.parse(raw) as Partial<OdteStore>;
    const count = ([1, 2, 3, 4] as const).includes(p.count as 1) ? (p.count as OdteStore['count']) : 4;
    const panes = DEFAULT_STORE.panes.map((d, i) => {
      const cfg = Array.isArray(p.panes) ? (p.panes[i] as Partial<PaneCfg> & { seg?: string }) : undefined;
      if (!cfg) return d;
      const legacy = typeof cfg.seg === 'string' ? LEGACY[cfg.seg] : undefined;
      const stored: NetFlowSegment = legacy?.seg ?? (isNetSegment(cfg.seg) ? cfg.seg : d.seg);
      const seg: NetFlowSegment = SAME_DAY_CUTS(stored) ? stored : d.seg;
      /* a stored name pane (every expiry) goes back to its slot's same-day cut — this desk draws same-day money only */
      if (legacy?.ticker || (typeof cfg.ticker === 'string' && cfg.ticker)) return d;
      const ticker = null;
      return {
        seg,
        mny: MNYS.includes(cfg.mny as MoneynessKey) ? (cfg.mny as MoneynessKey) : d.mny,
        ticker,
      };
    });
    return { count, panes };
  } catch {
    return DEFAULT_STORE;
  }
}

const Odte = () => {
  const { marketData, activeTicker } = useMarketData();
  const navigate = useNavigate();
  const [store, setStore] = useState<OdteStore>(loadStore);
  const [fsIdx, setFsIdx] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* private mode — layout just doesn't persist */
    }
  }, [store]);

  // Fullscreen: Esc exits, page scroll locks underneath.
  useEffect(() => {
    if (fsIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setFsIdx(null);
    };
    window.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = '';
    };
  }, [fsIdx]);

  const liveBook = useLiveBook(activeTicker).rows;
  // The shared hold (see LiveHold): book and tick freeze together while
  // paused, so every pane stops on the same bar.
  const hold = useHold(useMemo(() => ({ book: liveBook, tick: marketData }), [liveBook, marketData]), activeTicker);
  const { book, tick } = hold.value;
  const [guideOpen, setGuideOpen] = useState(false);

  /* THE HEAD READS THE SAME SERIES AS THE "EVERYTHING" PANE (2026-10-22): the panes draw the vendor's same-day minutes
     (/net-flow/expiry, zero_dte); a head summed off the book read −$68.2M of net calls over a pane reading +$3.9M. The
     book still counts the contracts — today's expiry only, the same day the vendor's minutes cover. */
  const flow = usePaneFlow({ ticker: null, seg: 'all', mny: 'all', zeroDte: true, enabled: true });
  const last = flow.rows.length ? flow.rows[flow.rows.length - 1] : null;
  const ncp = last?.callPrem ?? 0;
  const npp = last?.putPrem ?? 0;
  /* the head's instant — the last minute the vendor has a figure for */
  const asOf = last ? nyClock(last.time * 1000) : null;
  /* awake on MONEY, not on a timeline: a session of empty minutes read "leans bullish" on $0 against "+$0" */
  const awake = !!last && (ncp !== 0 || npp !== 0);
  const bullish = ncp - npp >= 0;
  // Signed on purpose — RichRead inks +$/-$ by direction (2026-08-30).
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${fmtUsd(v)}`;
  /* ONE COLOUR RULE: net puts bought lean bearish — said in words and inked as the direction they lean, never a green "+" */
  const putWords = (v: number) => (v >= 0 ? `bearish net puts bought ${fmtUsd(v)}` : `bullish net puts sold ${fmtUsd(Math.abs(v))}`);
  const read = awake
    ? `The same-day money leans ${bullish ? 'bullish' : 'bearish'} — net calls ${signed(ncp)} against ${putWords(npp)} on every contract ${sameDayWords()}, from the bell to ${asOf} ET.${isLiveDay() ? '' : ` That is the ${shortDay(tapeSessionIso())} session's same-day book — it expired at that bell.`}`
    : flow.fault
      ? 'This read did not land — the same-day minutes fill when the feed answers.'
      : 'The same-day money is still waking up.';

  const setPane = (i: number, patch: Partial<PaneCfg>) =>
    setStore(s => ({ ...s, panes: s.panes.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));


  /* The desk fills the frame: the grid takes every pixel down to the viewport
     floor and splits it EQUALLY — 2×2 for four panes, halves for two, one tall
     pane alone (Noah, 2026-08-30: "touch the bottom and in a 4 way split
     equally"). min-h-0 on the cells or the charts refuse to shrink. */
  const gridClass =
    store.count === 1
      ? 'grid grid-cols-1 grid-rows-1'
      : store.count === 2
        ? 'grid grid-cols-1 lg:grid-cols-2 grid-rows-1'
        : 'grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-2';

  const pane = (i: number, expanded = false) => {
    const cfg = store.panes[i];
    return (
      <NetFlowPane
        book={book}
        seg={cfg.seg}
        mny={cfg.mny}
        // Picking a cut is a way back from a name too: the pane returns to the book.
        onSeg={seg => setPane(i, { seg, ticker: null })}
        onMny={mny => setPane(i, { mny })}
        segments={SAME_DAY_CUTS}
        tick={tick}
        onExpand={() => setFsIdx(expanded ? null : i)}
        expanded={expanded}
      />
    );
  };

  // Keyed by count too: a layout switch REMOUNTS the pane so the chart
  // re-fits its new frame instead of hugging the old one's view.
  // Below lg the desk stacks and the page scrolls, so the frame has no height to split — each pane holds its own
  // (the phone sweep, 2026-10-22: the charts collapsed to their head strips).
  const renderPane = (i: number, extraClass = '') => (
    <div key={`${store.count}-${i}`} className={`h-[340px] lg:h-auto min-h-0 ${extraClass}`}>
      {pane(i)}
    </div>
  );

  return (
    <>
      <TraceBox
        title="The same-day money"
        sub="Net call and put premium flowing through the session — one to four panes, each with its own cut, name, money and clock · double-click a pane to reset its view"
        testId="odte"
        className="flex-1 min-h-0"
        data={{ panes: store.count }}
        guide={{ title: 'How to read the desk', door: 'What the lines, the floor and the panes mean', body: <OdteGuide />, testId: 'odte-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label="Leans" testId="lean">
              <span className={!awake ? 'text-textMuted' : bullish ? 'text-bull' : 'text-bear'}>{awake ? (bullish ? 'bullish' : 'bearish') : '—'}</span>
            </Fact>
            <Fact label="Net calls" testId="calls" title={VENDOR_TOTAL_NOTE}>
              {awake ? <Lean v={ncp} /> : <span className="text-textMuted">—</span>}
            </Fact>
            <Fact label="Net puts" testId="puts" title={VENDOR_TOTAL_NOTE}>
              {/* net puts bought lean bearish and wear red; sold, bullish and green (Lean's `put`) */}
              {awake ? <Lean v={npp} put /> : <span className="text-textMuted">—</span>}
            </Fact>
            <Fact label="As of" testId="as-of" title={`The last minute the vendor's same-day series (/net-flow/expiry, zero_dte) has a figure for. ${VENDOR_TOTAL_NOTE}`}>
              {asOf ? `${asOf} ET` : '—'} <span className="text-textSecondary">· every contract {sameDayWords()}</span>
            </Fact>
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} />
            <DropdownSelect label="Panes" value={store.count} options={PANE_OPTIONS} onChange={n => setStore(s => ({ ...s, count: n }))} title="How many charts on the desk" testId="odte-panes" />
          </>
        }
        sentence={<RichRead text={read} />}
      >
        <div className={`${gridClass} gap-2 flex-1 min-h-0 border-t border-borderSubtle p-2`} data-odte-desk>
          {Array.from({ length: store.count }, (_, i) =>
            // Three panes: the last one stretches the full row.
            renderPane(i, store.count === 3 && i === 2 ? 'lg:col-span-2' : '')
          )}
        </div>
      </TraceBox>

      {fsIdx !== null && <div className="fixed inset-0 z-[80] bg-canvas p-3">{pane(fsIdx, true)}</div>}
    </>
  );
};

export default Odte;
