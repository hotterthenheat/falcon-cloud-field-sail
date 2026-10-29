/* A setup's page at /compass/<id>: the id is the setup's address, so the tracker, the tape and Back all land here.
   A contract that left the board says why. */

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
import { P1_MIN } from '../../data/compassParams';
import { COMPASS_SET } from '../../data/compassUniverse';
import type { Setup } from '../../types/compass';
import CampaignAnalysis from '../../components/compass/CampaignAnalysis';
import NameDesks from '../../components/compass/NameDesks';
import { signals } from '../../data/compassLedger';
import { nyClock, nyDay } from '../../core/nyTime';

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
  const held = heldSetup(id);
  const setup = useMemo(() => {
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
  }, [held, id, liveBook.setups]);
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
    const fired = signals().find(r => r.id === id);
    if (fired) {
      const o = fired.outcome;
      const result = o?.status === 'closed' && o.exit && o.fill
        ? `${o.exit.why}. Filled ${o.fill.ask.toFixed(2)}, out ${o.exit.px.toFixed(2)} at ${nyClock(o.exit.at, { zone: true })}, ${o.ret != null ? `${o.ret >= 0 ? '+' : '−'}${Math.abs(o.ret).toFixed(1)}%` : ''}.`
        : o?.status === 'unavailable'
          ? 'No valid quote stood a minute after the call. No price was substituted.'
          : o?.fill
            ? `Filled ${o.fill.ask.toFixed(2)}. Still open on its last read.`
            : 'Waiting for its fill.';
      return (
        <>
          {back}
          <div className="border border-borderSubtle rounded-md bg-panel px-5 py-6" data-setup-record={fired.key}>
            <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">{fired.ticker} · Book {fired.book}{fired.p1 != null ? ` · Model 1 ${(fired.p1 * 100).toFixed(1)}%` : ''}</span>
            <p className="mt-1 text-t16 font-semibold text-textPrimary">{fired.contract}</p>
            <p className="mt-2 text-t12 text-textSecondary">Called {nyDay(fired.firedAt, { weekday: true })}, {nyClock(fired.firedAt, { zone: true })} on {fired.bid.toFixed(2)} × {fired.ask.toFixed(2)}. {result}</p>
            <Link to="/compass/blotter" className="mt-3 inline-flex slayer-chip uppercase tracking-wider">The blotter</Link>
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
          <p className="mt-2 text-t12 text-textSecondary">Not on this pass. The tape opens a contract the scan is holding.</p>
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
      <div key={id} className="animate-soft-in-slow" data-setup-page={id}>
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
        <div className="mt-3">
          <NameDesks ticker={setup.ticker} sleeve={address.sleeve === 'odte' ? 'odte' : 'weekly'} />
        </div>
      </div>
    </>
  );
};

export default SetupPage;
