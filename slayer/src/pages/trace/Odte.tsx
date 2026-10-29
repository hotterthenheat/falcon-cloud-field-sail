/* The same-day money: a desk of one to four panes, each on its own same-day cut and moneyness, with the whole
   market's same-day net in the head. Layout and cuts persist. */

import { useEffect, useState } from 'react';
import { useTicker } from '../../context/MarketDataContext';
import { LiveHold, SessionMark, useHold } from '../../components/trace/LiveHold';
import { isNetSegment, VENDOR_TOTAL_NOTE, type MoneynessKey, type NetFlowSegment } from '../../data/flowBook';
import { tapeSessionIso, usd as fmtUsd, usePaneFlow } from '../../data/traceLive';
import { isLiveDay, sameDayWords, shortDay } from '../../components/trace/dayWords';
import { nyClock } from '../../core/nyTime';
import Lean from '../../components/trace/Lean';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import RichRead from '../../components/ui/RichRead';
import NetFlowPane from '../../components/trace/NetFlowPane';
import TraceBox, { Fact } from '../../components/trace/TraceBox';
import { OdteGuide } from '../../components/trace/TraceGuide';
import FlowSearch, { useSearchedName } from '../../components/trace/FlowSearch';
import SameDayName from '../../components/trace/SameDayName';
import { useQParam } from '../../components/trace/addressCut';

/* the searched name, kept across route changes within a visit */
const nameMemory = { q: '' };

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
}

interface OdteStore {
  count: 1 | 2 | 3 | 4;
  panes: PaneCfg[];
}

/* every pane is a same-day cut: the vendor has no same-day minute series for one name */
const DEFAULT_STORE: OdteStore = {
  count: 4,
  panes: [
    { seg: 'all', mny: 'all' },
    { seg: 'index-funds', mny: 'all' },
    { seg: 'indexes', mny: 'all' },
    { seg: 'all', mny: 'otm' },
  ],
};
/** The cuts the vendor has same-day minutes for: a sector's tide spans every expiry and stocks-only is empty */
const SAME_DAY_CUTS = (seg: NetFlowSegment) => seg === 'all' || seg === 'index-funds' || seg === 'indexes';

const MNYS: MoneynessKey[] = ['all', 'itm', 'otm', 'atm'];


function loadStore(): OdteStore {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return DEFAULT_STORE;
    const p = JSON.parse(raw) as Partial<OdteStore>;
    const count = ([1, 2, 3, 4] as const).includes(p.count as 1) ? (p.count as OdteStore['count']) : 4;
    const panes = DEFAULT_STORE.panes.map((d, i) => {
      const cfg = Array.isArray(p.panes) ? (p.panes[i] as Partial<PaneCfg> & { seg?: string; ticker?: unknown }) : undefined;
      /* a stored name pane (every expiry) goes back to its slot's same-day cut */
      if (!cfg || (typeof cfg.ticker === 'string' && cfg.ticker)) return d;
      const stored: NetFlowSegment = isNetSegment(cfg.seg) ? cfg.seg : d.seg;
      return {
        seg: SAME_DAY_CUTS(stored) ? stored : d.seg,
        mny: MNYS.includes(cfg.mny as MoneynessKey) ? (cfg.mny as MoneynessKey) : d.mny,
      };
    });
    return { count, panes };
  } catch {
    return DEFAULT_STORE;
  }
}

const Odte = () => {
  const { activeTicker } = useTicker();
  const [store, setStore] = useState<OdteStore>(loadStore);
  const [fsIdx, setFsIdx] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* private mode: the layout just does not persist */
    }
  }, [store]);

  /* full screen: Esc leaves, the page's scroll locks underneath */
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

  const [guideOpen, setGuideOpen] = useState(false);
  /* a name's same-day contracts: the search opens them under the desk */
  const [query, setQuery] = useQParam(nameMemory);
  const searched = useSearchedName(query);

  /* the head reads the same series as the "everything" pane; a hold stops every shared read, so the panes freeze too */
  const flow = usePaneFlow({ ticker: null, seg: 'all', mny: 'all', zeroDte: true, enabled: true });
  const hold = useHold(flow.rows, activeTicker, !(flow.waiting && flow.rows.length === 0));
  const rows = hold.value;
  const last = rows.length ? rows[rows.length - 1] : null;
  const ncp = last?.callPrem ?? 0;
  const npp = last?.putPrem ?? 0;
  const asOf = last ? nyClock(last.time * 1000) : null;
  /* awake on money, not on a timeline: empty minutes are no lean */
  const awake = !!last && (ncp !== 0 || npp !== 0);
  const bullish = ncp - npp >= 0;
  /* signed on purpose: RichRead inks +$/-$ by direction */
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${fmtUsd(v)}`;
  /* net puts bought lean bearish: said in words, never a green "+" */
  const putWords = (v: number) => (v >= 0 ? `bearish net puts bought ${fmtUsd(v)}` : `bullish net puts sold ${fmtUsd(Math.abs(v))}`);
  /* calls and puts leaning the same way are joined by "and", opposed by "against" */
  const read = awake
    ? `The same-day money leans ${bullish ? 'bullish' : 'bearish'} — net calls ${signed(ncp)} ${(ncp >= 0) === (npp < 0) ? 'and' : 'against'} ${putWords(npp)} on every contract ${sameDayWords()}, from the bell to ${asOf} ET.${isLiveDay() ? '' : ` That is the ${shortDay(tapeSessionIso())} session's same-day book — it expired at that bell.`}`
    : flow.fault
      ? 'This read did not land — the same-day minutes fill when the feed answers.'
      : 'The same-day money is still waking up.';

  const setPane = (i: number, patch: Partial<PaneCfg>) =>
    setStore(s => ({ ...s, panes: s.panes.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));


  /* the desk fills the frame and splits it equally; min-h-0 on the cells or the charts refuse to shrink */
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
        seg={cfg.seg}
        mny={cfg.mny}
        onSeg={seg => setPane(i, { seg })}
        onMny={mny => setPane(i, { mny })}
        segments={SAME_DAY_CUTS}
        onExpand={() => setFsIdx(expanded ? null : i)}
        expanded={expanded}
      />
    );
  };

  /* keyed by count, so a layout switch remounts the pane and the chart fits its new frame; below lg each pane holds its
     own height, since a stacked desk has no frame to split */
  const renderPane = (i: number, extraClass = '') => (
    <div key={`${store.count}-${i}`} className={`h-[340px] lg:h-auto min-h-0 ${extraClass}`}>
      {pane(i)}
    </div>
  );

  return (
    <>
      <TraceBox
        title="The same-day money"
        sub="Net call and put premium through the session · one to four panes, each on its own cut · double-click to reset"
        testId="odte"
        className="flex-1 min-h-0"
        data={{ panes: store.count }}
        foldOnPhone
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
              {awake ? <Lean v={npp} put /> : <span className="text-textMuted">—</span>}
            </Fact>
            <Fact label="As of" testId="as-of" title={`The same-day series' last minute. ${VENDOR_TOTAL_NOTE}`}>
              {asOf ? `${asOf} ET` : '—'} <span className="text-textSecondary">· every contract {sameDayWords()}</span>
            </Fact>
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
            <SessionMark at={flow.at} fault={flow.fault} paused={hold.paused} ttlMs={45_000} kept={flow.kept} />
            <DropdownSelect label="Panes" value={store.count} options={PANE_OPTIONS} onChange={n => setStore(s => ({ ...s, count: n }))} title="How many charts on the desk" testId="odte-panes" />
            <FlowSearch value={query} onChange={setQuery} rows={[]} countNoun="contracts" span />
          </>
        }
        sentence={null}
        lead={awake ? `Same-day options ${isLiveDay() ? 'today' : `on ${shortDay(tapeSessionIso())}`} lean ${bullish ? 'bullish' : 'bearish'} — ${ncp >= 0 ? `calls bought ${fmtUsd(ncp)}` : `calls sold ${fmtUsd(Math.abs(ncp))}`}, ${npp >= 0 ? `puts bought ${fmtUsd(npp)}` : `puts sold ${fmtUsd(Math.abs(npp))}`} (to ${asOf} ET).` : read}
        detail={awake ? <RichRead text={read} /> : null}
      >
        <div className={`${gridClass} gap-2 flex-1 min-h-0 border-t border-borderSubtle p-2`} data-odte-desk>
          {Array.from({ length: store.count }, (_, i) =>
            /* three panes: the last one takes the full row */
            renderPane(i, store.count === 3 && i === 2 ? 'lg:col-span-2' : '')
          )}
        </div>
      </TraceBox>

      {searched && <SameDayName name={searched} iso={tapeSessionIso()} query={query} />}
      {fsIdx !== null && <div className="fixed inset-0 z-[80] bg-canvas p-3">{pane(fsIdx, true)}</div>}
    </>
  );
};

export default Odte;
