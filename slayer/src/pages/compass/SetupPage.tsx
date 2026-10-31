/* A setup's page at /compass/<id>: the id is the setup's address, so the board, the Tracker, the Blotter, the tape and
   Back all land here. A live call reads the live quote. A call that has left the scan (a past session, or the market
   shut) is read off its record: the same page, its chart and its numbers from that session (?day=YYYY-MM-DD picks the
   session when one contract was called on more than one). */

import { useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { setCompassView } from '../../data/compassView';
import { ArrowLeft, LayoutGrid } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { suggest } from '../notFound/suggest';
import { useNotFoundHead } from '../notFound/NotFound';
import { parseSetupId, setupIdOf } from '../../data/compass';
import { liveSetup, liveSpot, useThetaBook } from '../../data/thetaBook';
import { heldSetup, leftOf } from '../../data/compassModel';
import { P1_MIN, modelOfBook, weekdayDte } from '../../data/compassParams';
import { COMPASS_SET } from '../../data/compassUniverse';
import type { Setup } from '../../types/compass';
import CampaignAnalysis from '../../components/compass/CampaignAnalysis';
import { nyIsoDate } from '../../core/nyTime';
import { useSignals, wouldSignals, type Signal } from '../../data/compassLedger';

/** A recorded call as the page's setup: the record's own fields, nothing guessed. Greeks come from the session's
    history on the page; the model's score is never carried. */
function setupOfSignal(s: Signal): Setup {
  const dte = s.expiry === s.day ? 0 : weekdayDte(s.day, s.expiry);
  const mid = (s.bid + s.ask) / 2;
  return {
    id: s.id,
    ticker: s.ticker,
    contract: s.contract,
    right: s.right,
    strike: s.strike,
    expiry: dte === 0 ? '0DTE' : `${Number.isFinite(dte) ? dte : 1}DTE`,
    expiryDate: s.expiry,
    sessionsLeft: 0,
    sigmaMovePct: 0,
    sleeve: s.sleeve,
    score: 0,
    verdict: 'ENTER',
    topRated: false,
    topOpportunity: false,
    expectedMovePct: 0,
    swingTarget: { price: 0, pct: 0 },
    scalpExit: { price: 0, pct: 0 },
    headline: '',
    whyChips: [],
    whyText: '',
    greeks: { delta: NaN, gamma: NaN, theta: NaN, vega: NaN, iv: NaN },
    bid: s.bid,
    ask: s.ask,
    mid,
    liveMid: mid,
    highWater: s.outcome?.peak ?? 0,
    confidence: 0,
    health: 0,
    momentum: 'NEUTRAL',
    takeProfits: [],
    priceTargets: [],
    liquidityLabel: 'Normal',
    liquiditySpread: '',
    spot: s.spot ?? undefined,
    quotedAt: s.quoteAt,
    seenAt: s.firedAt,
    mark: s.mark,
    late: s.how === 'late',
    outsideTrained: s.outsideTrained,
    tapeSession: s.tapeSession,
    flatAt: s.flatAt,
    runner: s.runner,
    band: s.book === 'A' ? 'top' : s.book === 'B' ? 'wing' : 'lottery',
    invalidationPrice: 0,
    invalidationReason: '',
  } as Setup;
}

const SetupPage = () => {
  const { id = '' } = useParams();
  /* landing here makes this THE contract the reader is inside — the sidebar keeps it until another page like this one is landed on */
  useEffect(() => {
    if (id) setCompassView({ chosenId: id });
  }, [id]);
  const location = useLocation();
  const navigate = useNavigate();
  const { activeTicker, changeTicker } = useTicker();
  const from = (location.state as { from?: string } | null)?.from ?? null;
  const askedDay = new URLSearchParams(location.search).get('day') ?? '';
  const address = useMemo(() => {
    const parsed = parseSetupId(id);
    if (!parsed || !COMPASS_SET.has(parsed.ticker)) return null;
    return parsed;
  }, [id]);

  /* The desk REPOINTS to the contract's underlying — a QQQ setup over an SPY chain was the monitor pricing the
     wrong market */
  useEffect(() => {
    if (address && address.ticker !== activeTicker) changeTicker(address.ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address?.ticker]);

  const liveBook = useThetaBook(address?.sleeve === 'weekly' ? 'weekly' : 'odte');
  const record = useSignals();
  const held = heldSetup(id);
  const setup = useMemo(() => {
    /* an asked session other than today's is read off the record, never off today's quote */
    if (askedDay && askedDay !== nyIsoDate()) return null;
    if (!held || held.band === 'scalp' || held.band === 'average') return null;
    if (held.band !== 'top' && held.band !== 'wing' && held.band !== 'lottery' && held.band !== 'closest') return null;
    const dte = held.expiry === '0DTE' ? 0 : Number(/^(\d+)DTE$/.exec(held.expiry)?.[1]);
    if (held.band === 'lottery' && dte !== 0) return null;
    if (!(dte >= 0 && dte <= 7)) return null;
    if (held.band !== 'lottery' && held.band !== 'closest' && !(held.p1 != null && held.p1 + 1e-12 >= P1_MIN)) return null;
    const quote = liveBook.setups.find(s => s.id === id) ?? liveSetup(id);
    if (!quote) return held;
    return {
      ...quote,
      p1: held.p1,
      prun: held.prun,
      runner: held.runner,
      modelAgree: held.modelAgree,
      better: held.better,
      band: held.band,
      strength: held.strength,
      seenAt: held.seenAt,
      verdict: held.band === 'closest' ? 'WATCH' : 'ENTER',
      score: 0,
      takeProfits: [],
      priceTargets: [],
      invalidationPrice: 0,
      invalidationReason: '',
      whyText: held.whyText,
    } as Setup;
  }, [held, id, liveBook.setups, askedDay]);

  /* the record of this address: the asked session's, else the newest (a late mark's would-have-called row too) */
  const fired = useMemo(() => {
    const rows = [...record, ...wouldSignals()].filter(r => r.id === id);
    if (askedDay) return rows.find(r => r.day === askedDay) ?? null;
    return rows.sort((a, b) => b.firedAt - a.firedAt)[0] ?? null;
  }, [record, id, askedDay]);
  const spot = liveSpot(setup?.ticker ?? address?.ticker ?? '') || 0;

  const back = (
    <div className="flex items-center gap-4" data-setup-back>
      <button
        type="button"
        onClick={() => (from ? navigate(-1) : navigate('/compass'))}
        className="group inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> {from ?? 'The board'}
      </button>
      {from && (
        <Link to="/compass" className="inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
          <LayoutGrid className="w-3.5 h-3.5" /> The board
        </Link>
      )}
    </div>
  );

  /* an address that names no setup is a dead end: the tab says so and the page is kept out of search results */
  useNotFoundHead(!address);
  const meant = !address && id ? suggest(`/compass/${id}`)[0] : undefined;
  if (!address) {
    return (
      <>
        {back}
        <div className="border border-borderSubtle rounded-md bg-panel h-40 flex flex-col items-center justify-center gap-2" data-setup-missing>
          <span className="font-mono text-t13 font-bold text-textPrimary">{id}</span>
          <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">no setup at this address</span>
          {/* a slip of the hand lands here too — /compass/trakcer meant the Tracker */}
          {meant && (
            <Link to={meant.path} className="mt-1 text-t12 text-textSecondary hover:text-textPrimary transition-colors" data-not-found-link={meant.path}>
              Did you mean <span className="text-textPrimary font-medium underline decoration-borderMuted underline-offset-4">{meant.label}</span>?
            </Link>
          )}
        </div>
      </>
    );
  }

  /* A row of the contracts around it or the capsule's pick opens the next contract on the same name — its own page,
     with this one named as the way back. A pick can carry its own tenor: the page follows. */
  const openNext = (strike: number, right: 'C' | 'P', nextSleeve?: Setup['sleeve']) => {
    const sleeve = nextSleeve ?? address.sleeve;
    navigate(`/compass/${setupIdOf({ ticker: address.ticker, strike, right, scanner: address.scanner, sleeve })}`, { state: { from: setup?.contract ?? fired?.contract ?? 'The contract' } });
  };

  if (setup) {
    return (
      <>
        {back}
        <div key={id} className="animate-soft-in-slow" data-setup-page={id}>
          <CampaignAnalysis setup={setup} revision={setup.quotedAt ?? 0} spot={spot} scanner={address.scanner} sleeve={address.sleeve} onOpenContract={openNext} />
        </div>
      </>
    );
  }

  /* off the scan: the call's own record, the same page read from that session */
  if (fired) {
    return (
      <>
        {back}
        <div key={`${id}|${fired.day}`} className="animate-soft-in-slow" data-setup-page={id} data-setup-record={fired.key} data-setup-model={modelOfBook(fired.book)}>
          <CampaignAnalysis setup={setupOfSignal(fired)} revision={fired.pathAt} spot={0} scanner={address.scanner} sleeve={fired.sleeve} past={fired} />
        </div>
      </>
    );
  }

  const left = leftOf(id);
  if (left) {
    return (
      <>
        {back}
        <div className="border border-bear/30 bg-bear/[0.04] rounded-md px-5 py-6" data-setup-left={left.why}>
          <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">{left.ticker}</span>
          <p className="mt-1 text-t16 font-semibold text-textPrimary">{left.contract}</p>
          <p className="mt-2 font-mono text-t12 font-bold uppercase tracking-wider text-bear">{left.why}</p>
          <p className="mt-1 text-t12 text-textSecondary">This contract left the board. It is not a live pick.</p>
        </div>
      </>
    );
  }
  return (
    <>
      {back}
      <div className="border border-borderSubtle rounded-md bg-panel px-5 py-6" data-setup-missing>
        <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">{address.ticker}</span>
        <p className="mt-1 text-t16 font-semibold text-textPrimary">
          {address.ticker} {address.strike}
          {address.right}
        </p>
        <p className="mt-2 text-t12 text-textSecondary">{askedDay ? `No call on this contract on ${askedDay}.` : 'Not on this pass, and not on the record. The board opens a contract the scan is holding.'}</p>
      </div>
    </>
  );
};

export default SetupPage;
