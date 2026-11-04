/* A setup's page at /compass/<id>: the id is the setup's address, so the tracker, the tape and Back all land here.
   A contract that left the board says why. */

import { useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LayoutGrid } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { suggest } from '../notFound/suggest';
import { useNotFoundHead } from '../notFound/NotFound';
import { parseSetupId, setupIdOf } from '../../data/compass';
import { useThetaBook } from '../../data/thetaBook';
import { leftOf } from '../../data/compassModel';
import { P1_MIN, weekdayDte } from '../../data/compassParams';
import { sessionYmd } from '../../data/compassSession';
import { COMPASS_SET } from '../../data/compassUniverse';
import CampaignAnalysis from '../../components/compass/CampaignAnalysis';
import { scanMeta, onScanMeta } from '../../data/compassScan';
import { useSignals, type Signal } from '../../data/compassLedger';
import type { Setup, SleeveKey } from '../../types/compass';
import type { TailTicket } from '../../data/modelRisk';
import { useSyncExternalStore } from 'react';

function quoteSetup(row: {
  id: string;
  ticker: string;
  contract: string;
  right: Setup['right'];
  strike: number;
  expiry: string;
  sleeve: SleeveKey;
  bid: number;
  ask: number;
  spot: number | null;
  quotedAt: number;
  seenAt: number;
  iv?: number;
  gamma?: number;
}): Setup {
  const dte = weekdayDte(sessionYmd(), row.expiry);
  const sessionsLeft = Number.isFinite(dte) ? dte : 0;
  const bid = row.bid;
  const ask = row.ask;
  const mid = ask > 0 && bid >= 0 ? (bid + ask) / 2 : 0;
  const spread = ask > 0 && ask >= bid ? (ask - bid) / ask : NaN;
  const liquidityLabel: Setup['liquidityLabel'] = !(spread > 0) ? 'Tight' : spread > 0.08 ? 'Wide' : spread > 0.03 ? 'Normal' : 'Tight';
  const ivPct = row.iv != null && row.iv > 0 ? (row.iv <= 8 ? row.iv * 100 : row.iv) : NaN;
  return {
    id: row.id,
    ticker: row.ticker,
    contract: row.contract,
    right: row.right,
    strike: row.strike,
    expiry: sessionsLeft <= 0 ? '0DTE' : `${sessionsLeft}DTE`,
    expiryDate: row.expiry,
    sessionsLeft,
    sigmaMovePct: 0,
    sleeve: row.sleeve,
    score: 0,
    verdict: 'WATCH',
    topRated: false,
    topOpportunity: false,
    expectedMovePct: 0,
    swingTarget: { price: 0, pct: 0 },
    scalpExit: { price: 0, pct: 0 },
    headline: 'Tail risk',
    whyChips: [],
    whyText: 'Tail risk. No stop. The bid is sold when the close comes back through the line.',
    greeks: { delta: NaN, gamma: row.gamma != null && Number.isFinite(row.gamma) ? row.gamma : NaN, theta: NaN, vega: NaN, iv: ivPct },
    bid,
    ask,
    mid,
    liveMid: mid,
    highWater: ask,
    confidence: 0,
    health: 0,
    momentum: 'NEUTRAL',
    takeProfits: [],
    priceTargets: [],
    liquidityLabel,
    liquiditySpread: Number.isFinite(spread) ? `${(spread * 100).toFixed(1)}%` : '—',
    spot: row.spot ?? undefined,
    quotedAt: row.quotedAt,
    seenAt: row.seenAt,
    invalidationPrice: 0,
    invalidationReason: 'Back through the line',
  };
}

function setupFromTail(sig: Signal): Setup {
  return quoteSetup({
    id: sig.id,
    ticker: sig.ticker,
    contract: sig.contract,
    right: sig.right,
    strike: sig.strike,
    expiry: sig.expiry,
    sleeve: sig.sleeve,
    bid: sig.bid,
    ask: sig.ask,
    spot: sig.spot,
    quotedAt: sig.quoteAt,
    seenAt: sig.firedAt,
  });
}

function setupFromTicket(t: TailTicket): Setup {
  return quoteSetup({
    id: `tail|${t.ticker}|${t.book}|${t.right}`,
    ticker: t.ticker,
    contract: t.contract,
    right: t.right,
    strike: t.strike,
    expiry: t.expiry,
    sleeve: t.book === '0' ? 'odte' : 'weekly',
    bid: t.entryBid,
    ask: t.entryAsk,
    spot: t.spot,
    quotedAt: t.entryAt,
    seenAt: t.entryAt,
    iv: t.iv,
    gamma: t.gamma,
  });
}

const SetupPage = () => {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { activeTicker, changeTicker } = useTicker();
  const from = (location.state as { from?: string } | null)?.from ?? null;
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

  const odte = useThetaBook('odte');
  const weekly = useThetaBook('weekly');
  const record = useSignals();
  const tailPub = useSyncExternalStore(onScanMeta, () => scanMeta().tail, () => scanMeta().tail);
  const held = useMemo(() => {
    const all = [...odte.setups, ...weekly.setups, ...(odte.earlier?.setups ?? []), ...(weekly.earlier?.setups ?? [])];
    return all.find(s => s.id === id) ?? null;
  }, [odte.setups, odte.earlier, weekly.setups, weekly.earlier, id]);
  const setup = useMemo(() => {
    if (!held || held.band === 'scalp' || held.band === 'average') return null;
    if (held.band !== 'top' && held.band !== 'wing' && held.band !== 'lottery' && held.band !== 'closest') return null;
    const dte = held.expiry === '0DTE' ? 0 : Number(/^(\d+)DTE$/.exec(held.expiry)?.[1]);
    if (held.band === 'lottery' && dte !== 0) return null;
    if (!(dte >= 0 && dte <= 7)) return null;
    if (held.band !== 'lottery' && held.band !== 'closest' && !(held.p1 != null && held.p1 + 1e-12 >= P1_MIN)) return null;
    return held;
  }, [held, id]);
  const spot = held?.spot || setup?.spot || 0;

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

  if (!setup) {
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
    const tail = record.find(s => s.book === 'R' && s.ticker === address.ticker && s.strike === address.strike && s.right === address.right && s.sleeve === address.sleeve);
    const ticket = tail ? null : [...(tailPub?.open ?? []), ...(tailPub?.closed ?? [])].find(t => t.ticker === address.ticker && t.strike === address.strike && t.right === address.right && (t.book === '0' ? 'odte' : 'weekly') === address.sleeve);
    const built = tail ? setupFromTail(tail) : ticket ? setupFromTicket(ticket) : null;
    if (built) {
      return (
        <>
          {back}
          <div key={id} className="animate-soft-in-slow flex flex-col min-h-0 md:flex-1 md:min-h-0 md:overflow-hidden" data-setup-page={id}>
            <CampaignAnalysis
              setup={built}
              revision={built.quotedAt ?? 0}
              spot={built.spot ?? 0}
              scanner={address.scanner}
              sleeve={address.sleeve}
              onOpenContract={(strike, right, nextSleeve) => {
                const sleeve = nextSleeve ?? address.sleeve;
                navigate(`/compass/${setupIdOf({ ticker: address.ticker, strike, right, scanner: address.scanner, sleeve })}`, { state: { from: built.contract } });
              }}
            />
          </div>
        </>
      );
    }
    const fired = record.find(r => r.id === id);
    if (fired) {
      const fromRecord = setupFromTail(fired);
      return (
        <>
          {back}
      <div key={id} className="animate-soft-in-slow flex flex-col min-h-0 md:flex-1 md:min-h-0 md:overflow-hidden" data-setup-page={id} data-setup-record={fired.key}>
            <CampaignAnalysis
              setup={fromRecord}
              revision={fired.quoteAt || fired.firedAt}
              spot={fired.spot ?? 0}
              scanner={address.scanner}
              sleeve={address.sleeve}
              onOpenContract={(strike, right, nextSleeve) => {
                const sleeve = nextSleeve ?? address.sleeve;
                navigate(`/compass/${setupIdOf({ ticker: address.ticker, strike, right, scanner: address.scanner, sleeve })}`, { state: { from: fromRecord.contract } });
              }}
            />
          </div>
        </>
      );
    }
    return (
      <>
        {back}
        <div className="border border-borderSubtle rounded-md bg-panel px-5 py-6" data-setup-missing>
          <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">{address.ticker}</span>
          <p className="mt-1 text-t16 font-semibold text-textPrimary">{address.ticker} {address.strike}{address.right}</p>
          <p className="mt-2 text-t12 text-textSecondary">{odte.status === 'loading' || weekly.status === 'loading' ? 'Reading the scan.' : 'Not on this pass. The tape opens a contract the scan is holding.'}</p>
        </div>
      </>
    );
  }

  /* A driver row or the capsule's pick opens the next contract on the same
     name — its own page, with this one named as the way back. A pick can
     carry ITS OWN tenor (the capsule spans tenors): the page follows. */
  return (
    <>
      {back}
      <div key={id} className="animate-soft-in-slow flex flex-col min-h-0 md:flex-1 md:min-h-0 md:overflow-hidden" data-setup-page={id}>
        <CampaignAnalysis
          setup={setup}
          revision={setup.quotedAt ?? 0}
          spot={spot}
          scanner={address.scanner}
          sleeve={address.sleeve}
          onOpenContract={(strike, right, nextSleeve) => {
            const sleeve = nextSleeve ?? address.sleeve;
            navigate(`/compass/${setupIdOf({ ticker: address.ticker, strike, right, scanner: address.scanner, sleeve })}`, { state: { from: setup.contract } });
          }}
        />
      </div>
    </>
  );
};

export default SetupPage;
